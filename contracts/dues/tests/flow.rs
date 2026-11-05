//! End-to-end tests on a local NEAR sandbox (near-workspaces).
//!
//! Build the wasm first: `pnpm build:contract` (or `cargo near build
//! non-reproducible-wasm` inside contracts/dues and contracts/mock-usdc).

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccessKey, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

const USDC: u128 = 1_000_000; // 6 decimals

fn wasm(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../target/near")
        .join(name)
        .join(format!("{name}.wasm"));
    std::fs::read(&path).unwrap_or_else(|_| {
        panic!("{} is missing: run `pnpm build:contract` first", path.display())
    })
}

struct Env {
    worker: Worker<Sandbox>,
    usdc: Contract,
    dues: Contract,
    watcher: Account,
    ada: Account,  // freelancer
    acme: Account, // client
    eve: Account,  // anyone else
}

async fn account(root: &Account, name: &str) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?)
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let usdc_acc = account(&root, "usdc").await?;
    let dues_acc = account(&root, "dues").await?;
    let watcher = account(&root, "watcher").await?;
    let ada = account(&root, "ada").await?;
    let acme = account(&root, "acme").await?;
    let eve = account(&root, "eve").await?;

    let usdc = usdc_acc.deploy(&wasm("mock_usdc")).await?.into_result()?;
    usdc.call("new")
        .args_json(json!({ "owner_id": usdc.id(), "total_supply": (1_000_000 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;
    let dues = dues_acc.deploy(&wasm("dues")).await?.into_result()?;
    dues.call("new")
        .args_json(json!({ "owner_id": dues.id(), "watcher_id": watcher.id(), "usdc_id": usdc.id() }))
        .transact()
        .await?
        .into_result()?;

    // The escrow contract must be registered with USDC to receive retainer funding.
    for who in [dues.id(), ada.id()] {
        usdc.as_account()
            .call(usdc.id(), "storage_deposit")
            .args_json(json!({ "account_id": who, "registration_only": true }))
            .deposit(NearToken::from_millinear(125))
            .transact()
            .await?
            .into_result()?;
    }
    usdc.call("mint")
        .args_json(json!({ "account_id": acme.id(), "amount": (10_000 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;

    Ok(Env { worker, usdc, dues, watcher, ada, acme, eve })
}

impl Env {
    async fn invoice(&self, id: u64) -> anyhow::Result<Value> {
        Ok(self.dues.view("get_invoice").args_json(json!({ "id": id })).await?.json()?)
    }

    async fn balance(&self, who: &Account) -> anyhow::Result<u128> {
        let v: String = self
            .usdc
            .view("ft_balance_of")
            .args_json(json!({ "account_id": who.id() }))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    async fn now_ms(&self) -> anyhow::Result<u64> {
        Ok(self.worker.view_block().await?.timestamp() / 1_000_000)
    }

    async fn create(&self, args: Value) -> anyhow::Result<u64> {
        Ok(self
            .ada
            .call(self.dues.id(), "create_invoice")
            .args_json(args)
            .transact()
            .await?
            .into_result()?
            .json()?)
    }

    /// Waits (producing blocks) until the chain clock passes `ts_ms`.
    async fn wait_until(&self, ts_ms: u64) -> anyhow::Result<()> {
        for _ in 0..120 {
            if self.now_ms().await? > ts_ms {
                return Ok(());
            }
            self.worker.fast_forward(5).await?;
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        anyhow::bail!("sandbox clock never reached {ts_ms}")
    }
}

fn failed_with(res: &ExecutionFinalResult, needle: &str) -> bool {
    let text = format!("{:?}", res.clone().into_result().err());
    res.is_failure() && text.contains(needle)
}

#[tokio::test]
async fn create_then_mark_paid() -> anyhow::Result<()> {
    let e = setup().await?;
    let due = e.now_ms().await? + 7 * 86_400_000;
    let id = e
        .create(json!({
            "title": "Brand refresh",
            "amount_usdc": (25 * USDC).to_string(),
            "due_ts": due,
            "client": e.acme.id(),
            "items": [
                { "description": "Logo", "amount_usdc": (20 * USDC).to_string() },
                { "description": "Colour palette", "amount_usdc": (5 * USDC).to_string() }
            ]
        }))
        .await?;
    assert_eq!(id, 1);
    let inv = e.invoice(id).await?;
    assert_eq!(inv["status"], "pending");
    assert_eq!(inv["freelancer"], e.ada.id().as_str());

    // The watcher records the deposit address the buyer was quoted.
    e.watcher
        .call(e.dues.id(), "attach_deposit")
        .args_json(json!({ "id": id, "deposit_addr": "0x76b4c56085ED136a8744D52bE956396624a730E8" }))
        .transact()
        .await?
        .into_result()?;
    let open: Vec<Value> = e.dues.view("list_open_deposits").args_json(json!({})).await?.json()?;
    assert_eq!(open.len(), 1);

    // 1Click reports SUCCESS: the watcher marks it paid with both tx hashes.
    let res = e
        .watcher
        .call(e.dues.id(), "mark_paid")
        .args_json(json!({
            "id": id,
            "intent_tx": "6sCGhfYvqZ8iQkYfJMHWyNyFcTSJjQ4NWbD7xZNskAzp",
            "origin_chain": "base",
            "origin_tx": "0x5f0e9b4bb0e5b0b6a3b1f2a6c4b9f84d1d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a",
            "amount_usdc": (25 * USDC).to_string(),
            "fee_usdc": "41210"
        }))
        .transact()
        .await?;
    assert!(res.is_success(), "{:?}", res.into_result().err());
    let inv = e.invoice(id).await?;
    assert_eq!(inv["status"], "paid");
    assert_eq!(inv["txs"][0]["kind"], "intent");
    assert_eq!(inv["txs"][0]["origin_chain"], "base");
    assert_eq!(inv["txs"][0]["fee_usdc"], "41210");
    assert!(inv["deposit_addr"].is_null());
    let open: Vec<Value> = e.dues.view("list_open_deposits").args_json(json!({})).await?.json()?;
    assert!(open.is_empty());

    // Paying twice is impossible.
    let again = e
        .watcher
        .call(e.dues.id(), "mark_paid")
        .args_json(json!({ "id": id, "intent_tx": "x" }))
        .transact()
        .await?;
    assert!(failed_with(&again, "invoice is not pending"));

    let by_client: Vec<Value> = e
        .dues
        .view("list_by_client")
        .args_json(json!({ "account_id": e.acme.id() }))
        .await?
        .json()?;
    assert_eq!(by_client.len(), 1);
    Ok(())
}

#[tokio::test]
async fn only_the_watcher_reports_payments() -> anyhow::Result<()> {
    let e = setup().await?;
    let id = e
        .create(json!({ "title": "Audit", "amount_usdc": (10 * USDC).to_string(), "due_ts": 0 }))
        .await?;
    for who in [&e.ada, &e.acme, &e.eve] {
        let res = who
            .call(e.dues.id(), "mark_paid")
            .args_json(json!({ "id": id, "intent_tx": "fake" }))
            .transact()
            .await?;
        assert!(failed_with(&res, "only the watcher account"), "{} could mark paid", who.id());
        let res = who
            .call(e.dues.id(), "mark_refunded")
            .args_json(json!({ "id": id }))
            .transact()
            .await?;
        assert!(failed_with(&res, "only the watcher account"));
    }
    // A stranger cannot point the invoice at their own deposit address.
    let res = e
        .eve
        .call(e.dues.id(), "attach_deposit")
        .args_json(json!({ "id": id, "deposit_addr": "attacker" }))
        .transact()
        .await?;
    assert!(failed_with(&res, "only the watcher or the freelancer"));
    // Underpayment is rejected even from the watcher.
    let res = e
        .watcher
        .call(e.dues.id(), "mark_paid")
        .args_json(json!({ "id": id, "intent_tx": "h", "amount_usdc": (9 * USDC).to_string() }))
        .transact()
        .await?;
    assert!(failed_with(&res, "received less than the invoice amount"));
    // And the owner can rotate the watcher; the old one loses access.
    e.dues
        .call("set_watcher")
        .args_json(json!({ "watcher_id": e.eve.id() }))
        .transact()
        .await?
        .into_result()?;
    let res = e
        .watcher
        .call(e.dues.id(), "mark_paid")
        .args_json(json!({ "id": id, "intent_tx": "h" }))
        .transact()
        .await?;
    assert!(failed_with(&res, "only the watcher account"));
    assert_eq!(e.invoice(id).await?["status"], "pending");
    Ok(())
}

#[tokio::test]
async fn refunds_and_cancellation() -> anyhow::Result<()> {
    let e = setup().await?;
    let a = e
        .create(json!({ "title": "Refunded one", "amount_usdc": (5 * USDC).to_string(), "due_ts": 0 }))
        .await?;
    e.watcher
        .call(e.dues.id(), "mark_refunded")
        .args_json(json!({ "id": a, "intent_tx": "9xRefund", "origin_chain": "sol" }))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.invoice(a).await?["status"], "refunded");

    let b = e
        .create(json!({ "title": "Cancelled one", "amount_usdc": (5 * USDC).to_string(), "due_ts": 0, "client": e.acme.id() }))
        .await?;
    // The client of a one-off invoice cannot cancel it, nor can a stranger.
    for who in [&e.acme, &e.eve] {
        let res = who.call(e.dues.id(), "cancel").args_json(json!({ "id": b })).transact().await?;
        assert!(failed_with(&res, "only the freelancer"));
    }
    e.ada
        .call(e.dues.id(), "cancel")
        .args_json(json!({ "id": b }))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.invoice(b).await?["status"], "cancelled");
    let res = e
        .watcher
        .call(e.dues.id(), "mark_paid")
        .args_json(json!({ "id": b, "intent_tx": "late" }))
        .transact()
        .await?;
    assert!(failed_with(&res, "invoice is not pending"));
    Ok(())
}

#[tokio::test]
async fn retainer_fund_pull_withdraw() -> anyhow::Result<()> {
    let e = setup().await?;
    let monthly = 1_500 * USDC;
    let due = e.now_ms().await? + 4_000;
    let id = e
        .create(json!({
            "title": "Design retainer",
            "amount_usdc": monthly.to_string(),
            "due_ts": due,
            "recurrence": "monthly",
            "client": e.acme.id()
        }))
        .await?;

    // Only the named client can fund; anything else is returned by the token.
    e.usdc
        .call("mint")
        .args_json(json!({ "account_id": e.eve.id(), "amount": monthly.to_string() }))
        .transact()
        .await?
        .into_result()?;
    e.eve
        .call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": e.dues.id(), "amount": monthly.to_string(), "msg": json!({ "invoice_id": id }).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.balance(&e.eve).await?, monthly);
    assert_eq!(e.invoice(id).await?["escrow_usdc"], "0");

    // Client funds three months.
    e.acme
        .call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": e.dues.id(), "amount": (3 * monthly).to_string(), "msg": json!({ "invoice_id": id }).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let inv = e.invoice(id).await?;
    assert_eq!(inv["escrow_usdc"], (3 * monthly).to_string());
    assert_eq!(inv["retainer"], true);

    // Before the due date nothing moves.
    let early = e.eve.call(e.dues.id(), "pull").args_json(json!({ "id": id })).gas(near_workspaces::types::Gas::from_tgas(60)).transact().await?;
    assert!(failed_with(&early, "not due yet"));

    // The client grants a key that can call `pull` and nothing else.
    let pull_key = SecretKey::from_random(KeyType::ED25519);
    e.acme
        .batch(e.acme.id())
        .add_key(
            pull_key.public_key(),
            AccessKey::function_call_access(e.dues.id(), &["pull"], Some(NearToken::from_millinear(250))),
        )
        .transact()
        .await?
        .into_result()?;
    let scheduler = Account::from_secret_key(e.acme.id().clone(), pull_key, &e.worker);

    e.wait_until(due).await?;
    let before = e.balance(&e.ada).await?;
    let res = scheduler
        .call(e.dues.id(), "pull")
        .args_json(json!({ "id": id }))
        .gas(near_workspaces::types::Gas::from_tgas(60))
        .transact()
        .await?;
    assert!(res.is_success(), "{:?}", res.into_result().err());
    assert_eq!(e.balance(&e.ada).await? - before, monthly);
    let inv = e.invoice(id).await?;
    assert_eq!(inv["escrow_usdc"], (2 * monthly).to_string());
    assert_eq!(inv["periods_paid"], 1);
    assert!(inv["due_ts"].as_u64().unwrap() > due + 27 * 86_400_000, "next pull is a month later");

    // Second pull in the same month is rejected.
    let res = scheduler
        .call(e.dues.id(), "pull")
        .args_json(json!({ "id": id }))
        .gas(near_workspaces::types::Gas::from_tgas(60))
        .transact()
        .await?;
    assert!(failed_with(&res, "not due yet"));

    // The pull key cannot withdraw or cancel on the client's behalf.
    let res = scheduler
        .call(e.dues.id(), "withdraw_remaining")
        .args_json(json!({ "id": id }))
        .gas(near_workspaces::types::Gas::from_tgas(60))
        .transact()
        .await;
    assert!(res.is_err() || res.unwrap().is_failure(), "pull key must not reach withdraw_remaining");

    // Only the client can take the rest back.
    let res = e.ada.call(e.dues.id(), "withdraw_remaining").args_json(json!({ "id": id })).gas(near_workspaces::types::Gas::from_tgas(60)).transact().await?;
    assert!(failed_with(&res, "only the client can withdraw"));
    let client_before = e.balance(&e.acme).await?;
    e.acme
        .call(e.dues.id(), "withdraw_remaining")
        .args_json(json!({ "id": id }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(e.balance(&e.acme).await? - client_before, 2 * monthly);
    let inv = e.invoice(id).await?;
    assert_eq!(inv["status"], "cancelled");
    assert_eq!(inv["escrow_usdc"], "0");
    let kinds: Vec<&str> = inv["txs"].as_array().unwrap().iter().map(|t| t["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, vec!["fund", "pull", "withdraw"]);
    Ok(())
}

#[tokio::test]
async fn storage_deposit_registers_caller_with_usdc() -> anyhow::Result<()> {
    let e = setup().await?;
    let before: Option<Value> = e
        .usdc
        .view("storage_balance_of")
        .args_json(json!({ "account_id": e.eve.id() }))
        .await?
        .json()?;
    assert!(before.is_none());
    e.eve
        .call(e.dues.id(), "storage_deposit")
        .deposit(NearToken::from_micronear(1_250))
        .gas(near_workspaces::types::Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    let after: Option<Value> = e
        .usdc
        .view("storage_balance_of")
        .args_json(json!({ "account_id": e.eve.id() }))
        .await?
        .json()?;
    assert!(after.is_some());
    Ok(())
}
