//! Dues: invoices, retainer escrow and payment status, settled in USDC on NEAR.
//!
//! Two ways an invoice gets paid:
//!
//! 1. **Any chain, through NEAR Intents 1Click.** The buyer pays a 1Click deposit
//!    address; 1Click delivers USDC straight to the freelancer. The contract never
//!    holds those funds. A watcher account (set by the owner) reports the outcome
//!    with `mark_paid` or `mark_refunded`, and records the transaction hashes.
//! 2. **USDC on NEAR, directly.** A client who already holds USDC on NEAR
//!    `ft_transfer_call`s it to this contract with msg `{"invoice_id": N}`. For a
//!    one-off invoice the contract forwards exactly the invoice amount to the
//!    freelancer in the same transaction and returns any excess; if the forward
//!    fails the whole payment goes back to the client.
//! 3. **Retainer escrow on NEAR.** A client `ft_transfer_call`s USDC into this
//!    contract for a monthly invoice. `pull(id)` releases one month to the
//!    freelancer once that month is due. Anyone may call `pull`; it can only ever
//!    pay the freelancer the agreed amount, once per month. A client typically
//!    grants a function-call key limited to `pull` so a scheduler can run it.
//!
//! Identity is always `predecessor_account_id`, so calls relayed as NEP-366
//! meta-transactions act for the user who signed them, not for the relayer.

mod calendar;

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

const MAX_TITLE_LEN: usize = 120;
const MAX_ITEMS: usize = 20;
const MAX_ITEM_LEN: usize = 120;
const MAX_DEPOSIT_ADDR_LEN: usize = 128;
const MAX_HASH_LEN: usize = 128;
const MAX_CHAIN_LEN: usize = 16;
const MAX_TXS: usize = 400;
const MAX_PAGE: u32 = 100;
/// USDC on NEAR asks 0.00125 NEAR to register an account (NEP-145 minimum).
const USDC_STORAGE_DEPOSIT: NearToken = NearToken::from_micronear(1_250);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Invoices,
    ByFreelancer,
    ByClient,
    OpenDeposits,
    Retainers,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Recurrence {
    None,
    Monthly,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Waiting for payment (for a retainer: active, next month not yet pulled).
    Pending,
    /// Paid in full. The txs list holds the settlement transaction.
    Paid,
    /// The 1Click swap could not complete and the buyer was refunded.
    Refunded,
    /// Stopped by the freelancer, or a retainer stopped by the client.
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TxKind {
    /// 1Click delivered USDC to the freelancer.
    Intent,
    /// 1Click refunded the buyer.
    Refund,
    /// Client moved USDC into retainer escrow.
    Fund,
    /// One month released from escrow to the freelancer.
    Pull,
    /// Remaining escrow returned to the client.
    Withdraw,
    /// Client paid with USDC on NEAR; forwarded to the freelancer.
    Direct,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LineItem {
    pub description: String,
    pub amount_usdc: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TxRecord {
    pub kind: TxKind,
    /// NEAR transaction hash, when known. Contract-initiated transfers (pull,
    /// withdraw) get theirs filled in later by the watcher via `annotate_tx`.
    pub hash: Option<String>,
    /// Chain the buyer paid from (1Click blockchain id such as `base`, `sol`).
    pub origin_chain: Option<String>,
    /// Transaction hash on the origin chain.
    pub origin_tx: Option<String>,
    pub amount_usdc: U128,
    /// What the buyer paid on top of `amount_usdc` (swap and bridge fees), in USDC units.
    pub fee_usdc: U128,
    /// Unix time in milliseconds.
    pub ts: u64,
    /// Retainer month this record belongs to (1 = first month).
    pub period: Option<u32>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invoice {
    pub id: u64,
    pub freelancer: AccountId,
    pub client: Option<AccountId>,
    pub title: String,
    pub items: Vec<LineItem>,
    /// Amount in USDC base units (6 decimals): 25 USDC = "25000000".
    pub amount_usdc: U128,
    /// Unix time in milliseconds when payment is due.
    pub due_ts: u64,
    pub recurrence: Recurrence,
    pub status: Status,
    /// 1Click deposit address the buyer was given, while the payment is open.
    pub deposit_addr: Option<String>,
    pub txs: Vec<TxRecord>,
    pub created_ts: u64,
    /// For monthly invoices: day of month payments fall on.
    pub anchor_day: u32,
    /// Retainer escrow currently held for this invoice.
    pub escrow_usdc: U128,
    /// True once the client funded escrow; such invoices are paid by `pull` only.
    pub retainer: bool,
    pub periods_paid: u32,
    /// Monthly invoices paid through 1Click roll over into a fresh invoice for the
    /// next month; this points back to the previous one.
    pub previous_id: Option<u64>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub watcher_id: AccountId,
    pub usdc_id: AccountId,
    pub invoice_count: u64,
}

#[near(serializers = [json])]
struct FundMsg {
    invoice_id: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Dues {
    owner_id: AccountId,
    watcher_id: AccountId,
    usdc_id: AccountId,
    next_id: u64,
    invoices: LookupMap<u64, Invoice>,
    by_freelancer: LookupMap<AccountId, Vec<u64>>,
    by_client: LookupMap<AccountId, Vec<u64>>,
    open_deposits: IterableSet<u64>,
    retainers: IterableSet<u64>,
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn emit(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "dues",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

fn check_len(value: &str, max: usize, what: &str) {
    require!(!value.is_empty(), format!("{what} must not be empty"));
    require!(value.len() <= max, format!("{what} is too long"));
}

fn check_opt_len(value: &Option<String>, max: usize, what: &str) {
    if let Some(v) = value {
        check_len(v, max, what);
    }
}

#[near]
impl Dues {
    #[init]
    pub fn new(owner_id: AccountId, watcher_id: AccountId, usdc_id: AccountId) -> Self {
        Self {
            owner_id,
            watcher_id,
            usdc_id,
            next_id: 1,
            invoices: LookupMap::new(StorageKey::Invoices),
            by_freelancer: LookupMap::new(StorageKey::ByFreelancer),
            by_client: LookupMap::new(StorageKey::ByClient),
            open_deposits: IterableSet::new(StorageKey::OpenDeposits),
            retainers: IterableSet::new(StorageKey::Retainers),
        }
    }

    // ---------------------------------------------------------------- admin

    pub fn set_watcher(&mut self, watcher_id: AccountId) {
        self.assert_owner();
        self.watcher_id = watcher_id;
    }

    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = owner_id;
    }

    /// Owner-only code upgrade, so the contract account can drop its own
    /// full-access key. The new wasm is the raw call input. State is kept.
    pub fn update_contract(&mut self) -> Promise {
        self.assert_owner();
        let code = env::input().unwrap_or_else(|| env::panic_str("no code"));
        require!(code.len() > 8 && code[..4] == *b"\0asm", "input is not a wasm module");
        emit("update_contract", json!({ "size": code.len() }));
        Promise::new(env::current_account_id()).deploy_contract(code)
    }

    // ----------------------------------------------------------- freelancer

    /// Creates an invoice owned by the caller. Returns the invoice id.
    ///
    /// `amount_usdc` is in USDC base units. `due_ts` is Unix milliseconds.
    /// When `items` are given they must add up to `amount_usdc`.
    pub fn create_invoice(
        &mut self,
        title: String,
        amount_usdc: U128,
        due_ts: u64,
        recurrence: Option<Recurrence>,
        client: Option<AccountId>,
        items: Option<Vec<LineItem>>,
    ) -> u64 {
        let freelancer = env::predecessor_account_id();
        check_len(&title, MAX_TITLE_LEN, "title");
        require!(amount_usdc.0 > 0, "amount must be greater than zero");
        let items = items.unwrap_or_default();
        require!(items.len() <= MAX_ITEMS, "too many line items");
        if !items.is_empty() {
            let mut sum: u128 = 0;
            for item in &items {
                check_len(&item.description, MAX_ITEM_LEN, "line item description");
                sum = sum
                    .checked_add(item.amount_usdc.0)
                    .unwrap_or_else(|| env::panic_str("line items overflow"));
            }
            require!(sum == amount_usdc.0, "line items must add up to the amount");
        }
        if let Some(c) = &client {
            require!(c != &freelancer, "client and freelancer must differ");
        }

        let id = self.insert_invoice(Invoice {
            id: 0,
            freelancer,
            client,
            title,
            items,
            amount_usdc,
            due_ts,
            recurrence: recurrence.unwrap_or(Recurrence::None),
            status: Status::Pending,
            deposit_addr: None,
            txs: Vec::new(),
            created_ts: now_ms(),
            anchor_day: calendar::day_of_month(due_ts),
            escrow_usdc: U128(0),
            retainer: false,
            periods_paid: 0,
            previous_id: None,
        });
        let inv = self.invoices.get(&id).unwrap();
        emit(
            "invoice_created",
            json!({ "id": id, "freelancer": inv.freelancer, "amount_usdc": inv.amount_usdc }),
        );
        id
    }

    /// Stops an invoice. The freelancer can cancel any pending invoice; the
    /// client can cancel a monthly one. Cancelling never moves money: a client
    /// gets escrow back with `withdraw_remaining`.
    pub fn cancel(&mut self, id: u64) {
        let caller = env::predecessor_account_id();
        let inv = self.invoice_mut(id);
        require!(inv.status == Status::Pending, "only a pending invoice can be cancelled");
        let is_freelancer = caller == inv.freelancer;
        let is_client = inv.client.as_ref() == Some(&caller) && inv.recurrence == Recurrence::Monthly;
        require!(is_freelancer || is_client, "only the freelancer, or the client of a retainer, can cancel");
        inv.status = Status::Cancelled;
        inv.deposit_addr = None;
        let has_escrow = inv.escrow_usdc.0 > 0;
        self.open_deposits.remove(&id);
        if !has_escrow {
            self.retainers.remove(&id);
        }
        emit("invoice_cancelled", json!({ "id": id, "by": caller }));
    }

    /// Registers the caller with the USDC contract so payouts can reach them.
    /// The attached deposit (0.00125 NEAR) is forwarded to USDC as the NEP-145
    /// storage deposit. Through the relayer, the relayer pays it.
    #[payable]
    pub fn storage_deposit(&mut self) -> Promise {
        let deposit = env::attached_deposit();
        require!(
            deposit >= USDC_STORAGE_DEPOSIT,
            "attach 0.00125 NEAR for the USDC storage deposit"
        );
        Promise::new(self.usdc_id.clone()).function_call(
            "storage_deposit",
            json!({ "account_id": env::predecessor_account_id(), "registration_only": true })
                .to_string()
                .into_bytes(),
            deposit,
            GAS_STORAGE_DEPOSIT,
        )
    }

    // -------------------------------------------------------------- watcher

    /// Records the 1Click deposit address a buyer was given. Watcher or freelancer.
    pub fn attach_deposit(&mut self, id: u64, deposit_addr: String) {
        check_len(&deposit_addr, MAX_DEPOSIT_ADDR_LEN, "deposit address");
        let caller = env::predecessor_account_id();
        let watcher = self.watcher_id.clone();
        let inv = self.invoice_mut(id);
        require!(caller == watcher || caller == inv.freelancer, "only the watcher or the freelancer");
        require!(inv.status == Status::Pending, "invoice is not pending");
        require!(!inv.retainer, "retainer invoices are paid from escrow");
        inv.deposit_addr = Some(deposit_addr.clone());
        self.open_deposits.insert(id);
        emit("deposit_attached", json!({ "id": id, "deposit_addr": deposit_addr }));
    }

    /// 1Click reported SUCCESS. Watcher only. For a monthly invoice this also
    /// opens next month's invoice and returns its id.
    pub fn mark_paid(
        &mut self,
        id: u64,
        intent_tx: String,
        origin_chain: Option<String>,
        origin_tx: Option<String>,
        amount_usdc: Option<U128>,
        fee_usdc: Option<U128>,
    ) -> Option<u64> {
        self.assert_watcher();
        check_len(&intent_tx, MAX_HASH_LEN, "intent_tx");
        check_opt_len(&origin_chain, MAX_CHAIN_LEN, "origin_chain");
        check_opt_len(&origin_tx, MAX_HASH_LEN, "origin_tx");
        let ts = now_ms();
        let inv = self.invoice_mut(id);
        require!(inv.status == Status::Pending, "invoice is not pending");
        require!(!inv.retainer, "retainer invoices are paid by pull");
        let received = amount_usdc.unwrap_or(inv.amount_usdc);
        require!(received.0 >= inv.amount_usdc.0, "received less than the invoice amount");
        require!(inv.txs.len() < MAX_TXS, "too many transactions on this invoice");
        inv.status = Status::Paid;
        inv.deposit_addr = None;
        inv.periods_paid += 1;
        inv.txs.push(TxRecord {
            kind: TxKind::Intent,
            hash: Some(intent_tx.clone()),
            origin_chain,
            origin_tx,
            amount_usdc: received,
            fee_usdc: fee_usdc.unwrap_or(U128(0)),
            ts,
            period: None,
        });
        let next = (inv.recurrence == Recurrence::Monthly).then(|| Invoice {
            id: 0,
            freelancer: inv.freelancer.clone(),
            client: inv.client.clone(),
            title: inv.title.clone(),
            items: inv.items.clone(),
            amount_usdc: inv.amount_usdc,
            due_ts: calendar::add_one_month(inv.due_ts, inv.anchor_day),
            recurrence: Recurrence::Monthly,
            status: Status::Pending,
            deposit_addr: None,
            txs: Vec::new(),
            created_ts: ts,
            anchor_day: inv.anchor_day,
            escrow_usdc: U128(0),
            retainer: false,
            periods_paid: inv.periods_paid,
            previous_id: Some(id),
        });
        self.open_deposits.remove(&id);
        emit("invoice_paid", json!({ "id": id, "intent_tx": intent_tx, "amount_usdc": received }));
        next.map(|n| self.insert_invoice(n))
    }

    /// 1Click reported REFUNDED: the buyer got their funds back. Watcher only.
    pub fn mark_refunded(
        &mut self,
        id: u64,
        intent_tx: Option<String>,
        origin_chain: Option<String>,
        refund_tx: Option<String>,
    ) {
        self.assert_watcher();
        check_opt_len(&intent_tx, MAX_HASH_LEN, "intent_tx");
        check_opt_len(&origin_chain, MAX_CHAIN_LEN, "origin_chain");
        check_opt_len(&refund_tx, MAX_HASH_LEN, "refund_tx");
        let ts = now_ms();
        let inv = self.invoice_mut(id);
        require!(inv.status == Status::Pending, "invoice is not pending");
        require!(!inv.retainer, "retainer invoices are paid by pull");
        require!(inv.txs.len() < MAX_TXS, "too many transactions on this invoice");
        inv.status = Status::Refunded;
        inv.deposit_addr = None;
        inv.txs.push(TxRecord {
            kind: TxKind::Refund,
            hash: intent_tx,
            origin_chain,
            origin_tx: refund_tx,
            amount_usdc: U128(0),
            fee_usdc: U128(0),
            ts,
            period: None,
        });
        self.open_deposits.remove(&id);
        emit("invoice_refunded", json!({ "id": id }));
    }

    /// Fills in the NEAR transaction hash of a contract-initiated transfer
    /// (pull or withdraw) once it is known off-chain. Watcher only, write-once.
    pub fn annotate_tx(&mut self, id: u64, index: u32, hash: String) {
        self.assert_watcher();
        check_len(&hash, MAX_HASH_LEN, "hash");
        let inv = self.invoice_mut(id);
        let tx = inv
            .txs
            .get_mut(index as usize)
            .unwrap_or_else(|| env::panic_str("no such transaction"));
        require!(tx.hash.is_none(), "transaction hash already recorded");
        tx.hash = Some(hash);
    }

    // ------------------------------------------------------------- retainer

    /// Releases one month of escrow to the freelancer once it is due.
    /// Callable by anyone, typically by a function-call key the client granted
    /// that is limited to this method.
    pub fn pull(&mut self, id: u64) -> Promise {
        let (freelancer, amount, prev_due, period) = self.take_due_month(id);
        self.transfer_usdc(freelancer, amount, format!("Dues invoice {id}, month {period}"))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_pull_settled(id, U128(amount), prev_due, period),
            )
    }

    /// Client stops a retainer and takes back what is left in escrow. If a month
    /// is already due it is paid to the freelancer first.
    pub fn withdraw_remaining(&mut self, id: u64) -> PromiseOrValue<U128> {
        let caller = env::predecessor_account_id();
        {
            let inv = self.invoice(id);
            require!(inv.client.as_ref() == Some(&caller), "only the client can withdraw");
            require!(inv.retainer, "not a retainer");
            require!(
                matches!(inv.status, Status::Pending | Status::Cancelled),
                "retainer is closed"
            );
            require!(inv.escrow_usdc.0 > 0, "nothing left in escrow");
        }
        if self.month_is_due(id) {
            let (freelancer, amount, prev_due, period) = self.take_due_month(id);
            // Scheduled independently; it settles even though only the refund is returned.
            let _settle = self
                .transfer_usdc(freelancer, amount, format!("Dues invoice {id}, month {period}"))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_CALLBACK)
                        .on_pull_settled(id, U128(amount), prev_due, period),
                );
        }
        let ts = now_ms();
        let inv = self.invoice_mut(id);
        let refund = inv.escrow_usdc.0;
        inv.escrow_usdc = U128(0);
        inv.status = Status::Cancelled;
        inv.deposit_addr = None;
        inv.txs.push(TxRecord {
            kind: TxKind::Withdraw,
            hash: None,
            origin_chain: None,
            origin_tx: None,
            amount_usdc: U128(refund),
            fee_usdc: U128(0),
            ts,
            period: None,
        });
        self.retainers.remove(&id);
        emit("retainer_withdrawn", json!({ "id": id, "amount_usdc": U128(refund) }));
        if refund == 0 {
            // Everything left was the month just paid out.
            return PromiseOrValue::Value(U128(0));
        }
        self.transfer_usdc(caller, refund, format!("Dues invoice {id}, escrow returned"))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_withdraw_settled(id, U128(refund)),
            )
            .into()
    }

    #[private]
    pub fn on_pull_settled(&mut self, id: u64, amount: U128, prev_due_ts: u64, period: u32) -> bool {
        let ok = env::promise_result_checked(0, 64).is_ok();
        let inv = self.invoice_mut(id);
        if ok {
            emit("retainer_pulled", json!({ "id": id, "period": period, "amount_usdc": amount }));
            return true;
        }
        // Transfer failed (e.g. freelancer not registered with USDC): roll back.
        inv.escrow_usdc = U128(inv.escrow_usdc.0 + amount.0);
        inv.due_ts = prev_due_ts;
        inv.periods_paid = inv.periods_paid.saturating_sub(1);
        if let Some(pos) = inv
            .txs
            .iter()
            .rposition(|t| t.kind == TxKind::Pull && t.period == Some(period))
        {
            inv.txs.remove(pos);
        }
        // If the client already withdrew, the restored month goes back to them on the next withdraw.
        if inv.status == Status::Pending || inv.escrow_usdc.0 > 0 {
            self.retainers.insert(id);
        }
        emit("retainer_pull_failed", json!({ "id": id, "period": period }));
        false
    }

    #[private]
    pub fn on_withdraw_settled(&mut self, id: u64, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 64).is_ok();
        if ok {
            return true;
        }
        let inv = self.invoice_mut(id);
        inv.escrow_usdc = U128(inv.escrow_usdc.0 + amount.0);
        if let Some(pos) = inv.txs.iter().rposition(|t| t.kind == TxKind::Withdraw) {
            inv.txs.remove(pos);
        }
        self.retainers.insert(id);
        emit("retainer_withdraw_failed", json!({ "id": id }));
        false
    }

    /// Settles a direct USDC payment. Returns the amount the USDC contract
    /// must give back to the payer: the excess on success, everything on failure.
    #[private]
    pub fn on_direct_settled(&mut self, id: u64, received: U128, excess: U128, bound_client: bool) -> U128 {
        let ok = env::promise_result_checked(0, 64).is_ok();
        let inv = self.invoice_mut(id);
        if ok {
            let payer = inv.client.clone();
            emit(
                "invoice_paid",
                json!({ "id": id, "direct": true, "payer": payer, "amount_usdc": inv.amount_usdc }),
            );
            return excess;
        }
        // Forward failed (freelancer not registered with USDC): undo and refund in full.
        inv.status = Status::Pending;
        inv.periods_paid = inv.periods_paid.saturating_sub(1);
        if let Some(pos) = inv.txs.iter().rposition(|t| t.kind == TxKind::Direct) {
            inv.txs.remove(pos);
        }
        let unbind = if bound_client { inv.client.take() } else { None };
        if let Some(ids) = unbind.and_then(|c| self.by_client.get_mut(&c)) {
            if ids.last() == Some(&id) {
                ids.pop();
            }
        }
        emit("invoice_direct_failed", json!({ "id": id }));
        received
    }

    /// NEP-141 receiver. USDC sent with msg `{"invoice_id": N}` pays one-off
    /// invoice N (forwarded to the freelancer), or funds the retainer escrow of
    /// monthly invoice N. Anything else is returned.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.usdc_id {
            env::log_str("Dues only accepts USDC; returning tokens");
            return PromiseOrValue::Value(amount);
        }
        let Ok(FundMsg { invoice_id: id }) = serde_json::from_str::<FundMsg>(&msg) else {
            env::log_str("msg must be {\"invoice_id\": N}; returning tokens");
            return PromiseOrValue::Value(amount);
        };
        let Some(inv) = self.invoices.get(&id) else {
            env::log_str("unknown invoice; returning tokens");
            return PromiseOrValue::Value(amount);
        };
        if inv.recurrence == Recurrence::None {
            return self.pay_direct(id, sender_id, amount);
        }
        let reject = if inv.status != Status::Pending {
            Some("invoice is not active")
        } else if inv.client.as_ref().is_some_and(|c| c != &sender_id) {
            Some("only the invoice's client can fund it")
        } else if sender_id == inv.freelancer {
            Some("the freelancer cannot fund their own retainer")
        } else if inv.deposit_addr.is_some() {
            Some("this month is already being paid through 1Click")
        } else if inv.txs.len() >= MAX_TXS {
            Some("too many transactions on this invoice")
        } else {
            None
        };
        if let Some(reason) = reject {
            env::log_str(&format!("{reason}; returning tokens"));
            return PromiseOrValue::Value(amount);
        }

        let ts = now_ms();
        let newly_bound_client = inv.client.is_none();
        let inv = self.invoices.get_mut(&id).unwrap();
        inv.client = Some(sender_id.clone());
        inv.retainer = true;
        inv.escrow_usdc = U128(
            inv.escrow_usdc
                .0
                .checked_add(amount.0)
                .unwrap_or_else(|| env::panic_str("escrow overflow")),
        );
        inv.txs.push(TxRecord {
            kind: TxKind::Fund,
            hash: None,
            origin_chain: Some("near".to_string()),
            origin_tx: None,
            amount_usdc: amount,
            fee_usdc: U128(0),
            ts,
            period: None,
        });
        if newly_bound_client {
            self.index_push(false, &sender_id, id);
        }
        self.retainers.insert(id);
        emit("retainer_funded", json!({ "id": id, "client": sender_id, "amount_usdc": amount }));
        PromiseOrValue::Value(U128(0))
    }

    // ---------------------------------------------------------------- views

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            watcher_id: self.watcher_id.clone(),
            usdc_id: self.usdc_id.clone(),
            invoice_count: self.next_id - 1,
        }
    }

    pub fn get_invoice(&self, id: u64) -> Option<Invoice> {
        self.invoices.get(&id).cloned()
    }

    pub fn list_by_freelancer(
        &self,
        account_id: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<Invoice> {
        self.page_ids(self.by_freelancer.get(&account_id), from_index, limit)
    }

    pub fn list_by_client(
        &self,
        account_id: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<Invoice> {
        self.page_ids(self.by_client.get(&account_id), from_index, limit)
    }

    /// Pending invoices that have a 1Click deposit address: what the watcher polls.
    pub fn list_open_deposits(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let (from, limit) = page(from_index, limit);
        self.open_deposits
            .iter()
            .skip(from)
            .take(limit)
            .filter_map(|id| self.invoices.get(id).cloned())
            .collect()
    }

    /// Funded retainers whose next month is due now and covered by escrow.
    pub fn list_due_retainers(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let (from, limit) = page(from_index, limit);
        self.retainers
            .iter()
            .filter(|id| self.month_is_due(**id))
            .skip(from)
            .take(limit)
            .filter_map(|id| self.invoices.get(id).cloned())
            .collect()
    }

    /// All retainers that still hold escrow or are active.
    pub fn list_retainers(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let (from, limit) = page(from_index, limit);
        self.retainers
            .iter()
            .skip(from)
            .take(limit)
            .filter_map(|id| self.invoices.get(id).cloned())
            .collect()
    }
}

fn page(from_index: Option<u32>, limit: Option<u32>) -> (usize, usize) {
    (
        from_index.unwrap_or(0) as usize,
        limit.unwrap_or(50).min(MAX_PAGE) as usize,
    )
}

impl Dues {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "only the owner");
    }

    fn assert_watcher(&self) {
        require!(
            env::predecessor_account_id() == self.watcher_id,
            "only the watcher account can report payment status"
        );
    }

    fn invoice(&self, id: u64) -> &Invoice {
        self.invoices
            .get(&id)
            .unwrap_or_else(|| env::panic_str("no such invoice"))
    }

    fn invoice_mut(&mut self, id: u64) -> &mut Invoice {
        self.invoices
            .get_mut(&id)
            .unwrap_or_else(|| env::panic_str("no such invoice"))
    }

    fn insert_invoice(&mut self, mut inv: Invoice) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        inv.id = id;
        let freelancer = inv.freelancer.clone();
        let client = inv.client.clone();
        self.invoices.insert(id, inv);
        self.index_push(true, &freelancer, id);
        if let Some(c) = client {
            self.index_push(false, &c, id);
        }
        id
    }

    fn index_push(&mut self, freelancer: bool, account: &AccountId, id: u64) {
        let map = if freelancer { &mut self.by_freelancer } else { &mut self.by_client };
        match map.get_mut(account) {
            Some(ids) => ids.push(id),
            None => {
                map.insert(account.clone(), vec![id]);
            }
        }
    }

    fn page_ids(&self, ids: Option<&Vec<u64>>, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let (from, limit) = page(from_index, limit);
        ids.map(|ids| {
            ids.iter()
                .rev() // newest first
                .skip(from)
                .take(limit)
                .filter_map(|id| self.invoices.get(id).cloned())
                .collect()
        })
        .unwrap_or_default()
    }

    fn month_is_due(&self, id: u64) -> bool {
        self.invoices.get(&id).is_some_and(|inv| {
            inv.retainer
                && inv.status == Status::Pending
                && inv.due_ts <= now_ms()
                && inv.escrow_usdc.0 >= inv.amount_usdc.0
        })
    }

    /// Checks a retainer month is due and books it: escrow down, due date one
    /// month on, ledger entry added. Returns what to transfer.
    fn take_due_month(&mut self, id: u64) -> (AccountId, u128, u64, u32) {
        let ts = now_ms();
        let inv = self.invoice_mut(id);
        require!(inv.retainer, "not a funded retainer");
        require!(inv.status == Status::Pending, "retainer is not active");
        require!(inv.due_ts <= ts, "not due yet");
        require!(inv.escrow_usdc.0 >= inv.amount_usdc.0, "escrow does not cover this month");
        require!(inv.txs.len() < MAX_TXS, "too many transactions on this invoice");
        let amount = inv.amount_usdc.0;
        let prev_due = inv.due_ts;
        inv.escrow_usdc = U128(inv.escrow_usdc.0 - amount);
        inv.due_ts = calendar::add_one_month(inv.due_ts, inv.anchor_day);
        inv.periods_paid += 1;
        let period = inv.periods_paid;
        inv.txs.push(TxRecord {
            kind: TxKind::Pull,
            hash: None,
            origin_chain: Some("near".to_string()),
            origin_tx: None,
            amount_usdc: U128(amount),
            fee_usdc: U128(0),
            ts,
            period: Some(period),
        });
        (inv.freelancer.clone(), amount, prev_due, period)
    }

    /// One-off invoice paid with USDC on NEAR. Books it as paid and forwards
    /// the invoice amount to the freelancer; `on_direct_settled` confirms or undoes it.
    fn pay_direct(&mut self, id: u64, sender_id: AccountId, amount: U128) -> PromiseOrValue<U128> {
        let ts = now_ms();
        let inv = self.invoices.get(&id).unwrap();
        let reject = if inv.status != Status::Pending {
            Some("invoice is not pending")
        } else if inv.client.as_ref().is_some_and(|c| c != &sender_id) {
            Some("only the invoice's client can pay it")
        } else if sender_id == inv.freelancer {
            Some("the freelancer cannot pay their own invoice")
        } else if inv.deposit_addr.is_some() {
            Some("this invoice is already being paid through 1Click")
        } else if amount.0 < inv.amount_usdc.0 {
            Some("less than the invoice amount")
        } else if inv.txs.len() >= MAX_TXS {
            Some("too many transactions on this invoice")
        } else {
            None
        };
        if let Some(reason) = reject {
            env::log_str(&format!("{reason}; returning tokens"));
            return PromiseOrValue::Value(amount);
        }
        let bound_client = inv.client.is_none();
        let inv = self.invoices.get_mut(&id).unwrap();
        let due = inv.amount_usdc.0;
        let freelancer = inv.freelancer.clone();
        inv.client = Some(sender_id.clone());
        inv.status = Status::Paid;
        inv.periods_paid += 1;
        inv.txs.push(TxRecord {
            kind: TxKind::Direct,
            hash: None,
            origin_chain: Some("near".to_string()),
            origin_tx: None,
            amount_usdc: U128(due),
            fee_usdc: U128(0),
            ts,
            period: None,
        });
        if bound_client {
            self.index_push(false, &sender_id, id);
        }
        self.open_deposits.remove(&id);
        self.transfer_usdc(freelancer, due, format!("Dues invoice {id}"))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_direct_settled(id, amount, U128(amount.0 - due), bound_client),
            )
            .into()
    }

    fn transfer_usdc(&self, receiver: AccountId, amount: u128, memo: String) -> Promise {
        Promise::new(self.usdc_id.clone()).function_call(
            "ft_transfer",
            json!({ "receiver_id": receiver, "amount": U128(amount), "memo": memo })
                .to_string()
                .into_bytes(),
            ONE_YOCTO,
            GAS_FT_TRANSFER,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const DAY: u64 = 86_400_000;

    fn ctx(predecessor: AccountId, ts_ms: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(predecessor)
            .block_timestamp(ts_ms * 1_000_000)
            .build());
    }

    fn setup() -> Dues {
        ctx(accounts(0), 1_000);
        Dues::new(accounts(0), accounts(1), "usdc.near".parse().unwrap())
    }

    #[test]
    fn create_and_list() {
        let mut c = setup();
        ctx(accounts(2), 1_000);
        let id = c.create_invoice("Logo".into(), U128(25_000_000), 2_000, None, Some(accounts(3)), None);
        assert_eq!(id, 1);
        assert_eq!(c.list_by_freelancer(accounts(2), None, None).len(), 1);
        assert_eq!(c.list_by_client(accounts(3), None, None)[0].id, 1);
    }

    #[test]
    #[should_panic(expected = "line items must add up to the amount")]
    fn items_must_sum() {
        let mut c = setup();
        ctx(accounts(2), 1_000);
        let items = vec![LineItem { description: "a".into(), amount_usdc: U128(1) }];
        c.create_invoice("x".into(), U128(2), 0, None, None, Some(items));
    }

    #[test]
    #[should_panic(expected = "only the watcher account")]
    fn mark_paid_needs_watcher() {
        let mut c = setup();
        ctx(accounts(2), 1_000);
        let id = c.create_invoice("x".into(), U128(5), 0, None, None, None);
        c.mark_paid(id, "h".into(), None, None, None, None);
    }

    #[test]
    fn monthly_invoice_rolls_over_when_paid() {
        let mut c = setup();
        ctx(accounts(2), 1_000);
        let id = c.create_invoice("Retainer".into(), U128(5), 31 * DAY, Some(Recurrence::Monthly), None, None);
        ctx(accounts(1), 2_000);
        let next = c.mark_paid(id, "h".into(), Some("base".into()), Some("0xabc".into()), None, Some(U128(7))).unwrap();
        assert_eq!(c.get_invoice(id).unwrap().status, Status::Paid);
        let n = c.get_invoice(next).unwrap();
        assert_eq!(n.status, Status::Pending);
        assert_eq!(n.previous_id, Some(id));
        assert!(n.due_ts > 31 * DAY);
    }

    #[test]
    fn funding_from_wrong_token_is_returned() {
        let mut c = setup();
        ctx(accounts(2), 1_000);
        let id = c.create_invoice("R".into(), U128(5), 0, Some(Recurrence::Monthly), None, None);
        ctx(accounts(4), 1_000);
        match c.ft_on_transfer(accounts(3), U128(10), format!("{{\"invoice_id\":{id}}}")) {
            PromiseOrValue::Value(v) => assert_eq!(v.0, 10),
            _ => panic!("expected value"),
        }
    }

    #[test]
    fn funding_binds_client_and_pull_waits_for_due_date() {
        let mut c = setup();
        ctx(accounts(2), 1_000);
        let id = c.create_invoice("R".into(), U128(5), 10 * DAY, Some(Recurrence::Monthly), None, None);
        ctx("usdc.near".parse().unwrap(), 2_000);
        match c.ft_on_transfer(accounts(3), U128(15), format!("{{\"invoice_id\":{id}}}")) {
            PromiseOrValue::Value(v) => assert_eq!(v.0, 0),
            _ => panic!("expected value"),
        }
        let inv = c.get_invoice(id).unwrap();
        assert_eq!(inv.client, Some(accounts(3)));
        assert_eq!(inv.escrow_usdc.0, 15);
        assert!(c.list_due_retainers(None, None).is_empty());
        ctx(accounts(5), 10 * DAY);
        assert_eq!(c.list_due_retainers(None, None).len(), 1);
        let _ = c.pull(id);
        let inv = c.get_invoice(id).unwrap();
        assert_eq!(inv.escrow_usdc.0, 10);
        assert_eq!(inv.periods_paid, 1);
        assert!(inv.due_ts > 10 * DAY);
    }
}
