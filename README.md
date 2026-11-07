# Dues

**One checkout button. Any wallet, any chain. Settles in USDC on NEAR.**

Dues is two things:

1. **`<dues-checkout>`**, a checkout button any website can embed with one script tag. The buyer pays with whatever they hold (USDC on Base, SOL, ETH, USDT on Tron: 200+ tokens on 30+ chains) through [NEAR Intents 1Click](https://docs.near-intents.org). The seller receives exactly the amount asked for, in USDC on NEAR.
2. **Invoices and monthly retainers for freelancers**, built on that button. A freelancer creates an invoice without paying gas, sends a link, and gets paid from any chain. Each invoice shows paid, pending or refunded with every transaction linked, and exports to a CSV an accountant can read.

**A real payment, not a mock:** on Nov 7, 2026 a buyer paid a $2 checkout with USDC on Base, and exactly 2.00 USDC arrived on NEAR 28 seconds after the Base transaction: [Base deposit](https://basescan.org/tx/0x6c503b35fcc772a9bbdf86009c7c01a9bd7b1f8fb29d3c6c3253b402e442a99a), [NEAR delivery](https://nearblocks.io/txns/C7RY5goGbk4ac35kuWRzqGDUtW1tT2pLG4YsXomgzJZp). Details under [Mainnet](#mainnet-a-real-2-payment).

Why it matters, with sources: [docs/PROBLEM.md](docs/PROBLEM.md).

---

## Quickstart: everything on your machine, no keys, no accounts (about 2 minutes)

Needs Node 22+, pnpm 10, Rust with `wasm32-unknown-unknown`, and `cargo-near` (`cargo install --locked cargo-near`).

```bash
pnpm install
pnpm demo:dry
```

This builds the contract, starts a local NEAR sandbox, deploys Dues and a mock USDC, starts the relayer and the watcher, and runs the whole product. Expected ending:

```
8/8 scenes behaved as expected (20 s)
  ok   gasless onboarding      freelancer adds one session key, then pays no gas
  ok   1Click payment          live dry quote from 1Click, recorded status replay, USDC delivered
  ok   refund                  a 1Click payment that cannot complete is marked refunded
  ok   direct USDC             client pays USDC on NEAR, forwarded to the freelancer in one tx
  ok   relayer policy          4 refusals (other contract, other method, deposit, forged signature)
  ok   retainer                3 months escrowed, month 1 released by a pull-only key, rest withdrawn
  ok   csv                     4 rows, 3 paid
  ok   gasless overall         freelancer NEAR balance and key allowance unchanged
```

The CSV it writes is at `.dues/dry-run.csv`.

### Click through it

```bash
pnpm sandbox        # terminal 1: local chain, API on :3031, five seeded invoices
pnpm dev            # terminal 2: the app on http://localhost:3000
```

Sign in with the sandbox accounts `ada.sandbox` (freelancer) or `acme.sandbox` (client). Their keys exist only on the local chain and are written to `app/public/dues-config.json`, which is deleted when the sandbox stops. Then:

- **New invoice**: approve the session key once, create an invoice. No fee is charged to you.
- **Open the invoice link as the client**: pay with "Any wallet" (live 1Click price, recorded payment replay), "USDC on NEAR", or "Prepay months" for a retainer.
- **Retainer**: "+1 day" moves the sandbox clock to the due date and the scheduler releases one month.
- **Invoices**: totals, status tabs, transaction links, Export CSV.

### Checks

```bash
pnpm check     # contract build, 17 Rust tests (10 unit, 7 on a sandbox), typecheck of 7 packages, 29 TypeScript tests
```

---

## The checkout button

```html
<script src="https://<your-dues-host>/widget.js"></script>
<dues-checkout amount="25" to="you.near" memo="Order 1042"></dues-checkout>
```

```tsx
import { DuesCheckout } from '@dues/widget/react';

<DuesCheckout amount={25} to="you.near" onPaid={(p) => fulfil(p.nearTxHashes)} />
```

What it does, in order:

1. Loads the 1Click token list (`GET /v0/tokens`, cached 10 minutes, with a bundled copy as fallback) and lets the buyer pick a chain and token. Stablecoins are listed first.
2. Asks for an `EXACT_OUTPUT` quote (`POST /v0/quote`): the recipient gets exactly `amount` USDC on NEAR (`nep141:17208628…a1`); slippage and fees are on the buyer's side and shown before paying.
3. Shows the deposit address, a QR code (EIP-681 on EVM chains, Solana Pay, BIP-21) and links that open MetaMask, Coinbase Wallet or Phantom.
4. Polls the status (`GET /v0/status`) until SUCCESS, REFUNDED or FAILED. Once the payment settles it hides the deposit address so nobody pays it twice, links the deposit, the NEAR delivery and any change returned to the buyer, and fires `dues:paid` with the NEAR and origin-chain hashes.

| Attribute | Meaning |
|---|---|
| `amount` | USD the recipient receives, settled as USDC |
| `to` | NEAR account that receives USDC |
| `memo`, `invoice` | shown to the buyer; `invoice` is sent to `track-url` |
| `dry` | live prices, no deposit address, nothing can be paid |
| `track-url` | POST `{invoiceId, depositAddress}` here before the address is shown; if it fails the address is never shown |
| `status-url` | poll here instead of 1Click (a watcher that also settles the invoice on-chain) |
| `chain`, `token`, `refund-to` | preselect |
| `theme` | `light` or `dark` (default follows the system) |
| `compact` | hide amount and memo when the page already shows them |

Events: `dues:quote`, `dues:status`, `dues:paid`, `dues:error` (bubbling, composed). Bundle: `pnpm build:widget` writes `packages/widget/dist/widget.js` (about 83 KB, no dependencies on the host page).

---

## For the bookkeeper

### Status meanings

| Status | Meaning |
|---|---|
| **Open** (pending) | Waiting for payment. Nothing has been received. |
| **Payment in progress** | The client has a 1Click deposit address for this invoice and the payment is on its way. Still nothing received. |
| **Paid** | USDC reached the freelancer's NEAR account. The invoice links the NEAR transaction and, for a 1Click payment, the transaction on the chain the client paid from. |
| **Refunded** | The payment could not complete and 1Click returned the money to the payer on their own chain. Nothing was received. |
| **Cancelled** | Stopped by the freelancer (or, for a retainer, by the client). It can no longer be paid. |
| **Retainer active** | The client prepaid months into escrow. One month is released to the freelancer on each due date. |
| **Retainer ended** | The client stopped the retainer and took back the months not yet released. |

How 1Click statuses map: `PENDING_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `INCOMPLETE_DEPOSIT` stay **Open**; `SUCCESS` becomes **Paid** only after the watcher checks that the swap pays this freelancer, in USDC on NEAR, at least the invoice amount; `REFUNDED` becomes **Refunded**; `FAILED` is flagged for a person and never marked paid.

### CSV columns

One row per money event, so every row is something that happened. Export from the Invoices page, or `pnpm demo:dry` writes one.

| Column | Content |
|---|---|
| `date` | UTC date of the payment, refund or (for an open invoice) the due date |
| `invoice` | `#id title`, and `(month N)` for a retainer month |
| `client` | client's NEAR account, empty when a 1Click payer has none |
| `amount` | USDC received, 2 to 6 decimals |
| `fee` | conversion cost the payer paid on top (1Click only), USDC |
| `tx` | NEAR transaction link (refunds: the refund transaction on the payer's chain) |
| `status` | `paid`, `refunded`, `pending` or `cancelled` |

Retainer funding and returned escrow are the client's own money moving, not income, so they are not rows. Cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so a spreadsheet never runs them as formulas.

```
date,invoice,client,amount,fee,tx,status
2026-11-06,#1 Brand refresh,,25.00,0.260486,8tP1VSvz1PuotJECRzCuGVcecRaEosbvY1m5n1q5sVi,paid
2026-11-06,#2 Icon set,,12.00,0.00,0xe1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f708192a3b4c5d6e7f80910,refunded
2026-11-06,#3 Logo usage licence,acme.sandbox,40.00,0.00,4hjgerZVPBSnoDGyi3NqZy5guNh42wLJnj7nA9dqx6Mt,paid
2026-11-08,#4 Monthly design retainer (month 1),acme.sandbox,1500.00,0.00,EBmp9jQ9veiX9F211z1U4dxyckeaPaUn3fU2X56KkkxK,paid
```

---

## Testnet

The contract is deployed at **[`dues.testnet`](https://testnet.nearblocks.io/address/dues.testnet)** with testnet USDC (`3e2210e1…b8af`). Every transaction is recorded in [deployments/testnet.json](deployments/testnet.json).

| Step | Transaction |
|---|---|
| Deploy and initialise (owner `dues-owner.testnet`, watcher `dues-watcher.testnet`) | [DwJ6ty7u…](https://testnet.nearblocks.io/txns/DwJ6ty7uAQ1yyAE92smDj241gPwG1eo87grsX2rGGh8R) |
| Register the contract with USDC (it holds retainer escrow) | [6NQ6B3RG…](https://testnet.nearblocks.io/txns/6NQ6B3RG9BruRQS5fPmeKG96jqHczwvaqTmCuCjxaXcb) |
| Freelancer adds the session key (the one transaction they pay for) | [472VxNGi…](https://testnet.nearblocks.io/txns/472VxNGid4fBgaLW8Edkpg2KH2MxGpkksrHQFveK9Vxm) |
| Invoice #1 created as a meta-transaction; signed by the freelancer's session key, gas paid by `dues-relayer.testnet` | [AfqzVQEL…](https://testnet.nearblocks.io/txns/AfqzVQELExR3vzwUtNSBNY4nXqwXfDgVa7LnwhA7a4Zx) |
| Relayer registers the freelancer with USDC (0.00125 NEAR, paid by the relayer) | [Cm3m6kz3…](https://testnet.nearblocks.io/txns/Cm3m6kz3N88dmZWc8sitna2ouX8ySdfcDwj4s7AVzH5x) |
| Client pays invoice #1 with 1.00 testnet USDC on NEAR (`ft_transfer_call`); the contract forwards it to the freelancer in the same transaction and marks the invoice paid | [9paQnDbm…](https://testnet.nearblocks.io/txns/9paQnDbmo9ZFCnAUNuD7Un7x5v1GMLBN3MjnMjvP9RsD) |
| Watcher reads that transaction, finds the contract's own `invoice_paid` event and records the hash on the invoice | [5Ede8W9q…](https://testnet.nearblocks.io/txns/5Ede8W9q6FocxT9Pqyb3G2obh6AeRfCFmWu7cNDGX82F) |

Reproduce with your own accounts:

```bash
ACCOUNT_PREFIX=yourname pnpm accounts:testnet   # free accounts via the faucet helper; keys in ~/.near-credentials/testnet
DUES_CONTRACT=yourname.testnet OWNER_ACCOUNT_ID=yourname-owner.testnet ... pnpm deploy:testnet
pnpm testnet:flow    # session key, relayed create_invoice, USDC registration, then the client pays
```

The client needs testnet USDC from [faucet.circle.com](https://faucet.circle.com) (network: NEAR testnet). `pnpm testnet:flow` says so and stops if the balance is short; `INVOICE_ID=N pnpm testnet:flow` then pays that invoice.

**1Click has no testnet.** On testnet the any-chain checkout runs in dry mode: real prices, no deposit address. Real testnet payments use "USDC on NEAR". The any-chain path was proven on mainnet instead, below.

---

## Mainnet: a real $2 payment

The checkout button on its own, embedded in a plain HTML page with `<dues-checkout amount="2" to="godswillidolor.near" memo="Order 1042">`, no Dues contract and no keys. The buyer picked USDC on Base, typed a refund address, and sent USDC to the deposit address the widget showed. Recorded in [deployments/mainnet.json](deployments/mainnet.json); the full 1Click status response is the test fixture [fixtures/1click/status-success-mainnet.json](fixtures/1click/status-success-mainnet.json).

| Step | Amount | Transaction |
|---|---|---|
| Buyer sends USDC on Base to the deposit address (08:14:48 UTC) | 2.10 USDC (2.025291 quoted) | [0x6c503b35…](https://basescan.org/tx/0x6c503b35fcc772a9bbdf86009c7c01a9bd7b1f8fb29d3c6c3253b402e442a99a) |
| NEAR Intents delivers USDC on NEAR to `godswillidolor.near` (08:15:15 UTC) | exactly 2.00 USDC | [C7RY5goG…](https://nearblocks.io/txns/C7RY5goGbk4ac35kuWRzqGDUtW1tT2pLG4YsXomgzJZp) |
| Change returned to the buyer's refund address on Base | 0.092516 USDC | [0x1e925de3…](https://basescan.org/tx/0x1e925de33099e34556aab005b47a6a1bc56cbadabb65461ab9df5cdd276b1ece) |

What it cost the buyer: 2.005084 USDC was used for 2.00 USDC delivered. Most of the 0.005084 is a 0.004677 USDC withdrawal fee, which 1Click quotes only when the recipient is not yet registered with the USDC contract (the same quote to a registered account has none); after the payment the account was registered, with 0.00125 NEAR of storage. The buyer's wallet paid its own Base gas.

The invoice flow (contract, relayer, watcher) is on testnet only. To run it on mainnet, deploy the contract to a mainnet account, set `NEAR_NETWORK=mainnet` and `NEXT_PUBLIC_CHECKOUT_DRY=false`, and give the API the relayer and watcher keys (see [.env.example](.env.example)). The widget never needs keys; without `dry`, it shows a real deposit address.

---

## How it works

```
 freelancer browser                     client, any chain                       client on NEAR
 session key (create_invoice, cancel)   <dues-checkout> on the invoice page     wallet
        |  signed delegate action             | 1Click quote / deposit / status         | ft_transfer_call(USDC)
        v                                     v                                         v
   /api/relayer  ----meta-tx---->   +-----------------------------------------------+  <---- USDC
   pays gas, only for Dues          |  Dues contract (Rust)                           |
                                    |  invoices, status, ledger of tx hashes,         |
   /api/watcher  --mark_paid---->   |  retainer escrow, pull, withdraw                |
   checks 1Click: right recipient,  +-----------------------------------------------+
   USDC, full amount                                 |  pull on the due date (anyone; pays only the freelancer)
                                                     v
   /api/cron/pull (scheduler) ------------------> freelancer receives USDC on NEAR
```

Three ways an invoice is paid:

1. **Any chain, through 1Click.** The client pays a 1Click deposit address; 1Click delivers USDC straight to the freelancer. The contract never holds that money. The watcher reports the outcome with `mark_paid` (with the NEAR tx, origin chain and tx, amount and fee) or `mark_refunded`.
2. **USDC on NEAR, directly.** The client calls `ft_transfer_call` on USDC with msg `{"invoice_id": N}`. The contract forwards exactly the invoice amount to the freelancer in the same transaction and returns any excess. If the forward fails, the client gets everything back and the invoice stays open.
3. **Retainer escrow.** For a monthly invoice the same `ft_transfer_call` prepays months. `pull(id)` releases one month once it is due: anyone may call it, it pays only the freelancer, only the agreed amount, at most once a month. `withdraw_remaining` returns the rest to the client (paying a month already due first).

A monthly invoice paid through 1Click opens next month's invoice automatically (`previous_id` links them).

Contract methods: `create_invoice`, `cancel`, `storage_deposit` (relayed); `attach_deposit`, `mark_paid`, `mark_refunded`, `annotate_tx` (watcher); `pull`, `withdraw_remaining`, `ft_on_transfer`; owner-only `set_watcher`, `set_owner`, `update_contract`; views `get_invoice`, `list_by_freelancer`, `list_by_client`, `list_open_deposits`, `list_due_retainers`, `list_retainers`, `get_config`. Every change emits a NEP-297 `EVENT_JSON` log with `"standard": "dues"`.

---

## Relayer policy: what it pays for

The relayer submits NEP-366 meta-transactions and pays their gas. It refuses, before spending anything, a request that:

- is not addressed to the Dues contract (`receiver_not_allowed`);
- calls a method other than `create_invoice`, `cancel` or `storage_deposit` (`method_not_allowed`);
- attaches a deposit, except exactly 0.00125 NEAR on `storage_deposit` (`deposit_not_allowed`);
- has an action that is not a function call, more than 2 actions, more than 50 Tgas per action, or arguments that are not a JSON object under 4 KB;
- is expired, or valid for more than 600 blocks;
- has a signature that does not match the delegate action (`bad_signature`), or a non-ed25519 key;
- comes from the relayer itself, or exceeds 20 requests per sender per 10 minutes; `storage_deposit` is sponsored once per account.

After a sender's first relayed `create_invoice`, the relayer also registers them with USDC (`storage_deposit` on the USDC contract, 0.00125 NEAR), so payouts can reach them. It skips accounts already registered. It uses three full-access keys on its own account, rotated by `MultiKeySigner`, so parallel requests never share a nonce. `GET /api/relayer/policy` returns the live policy.

## What each key can and cannot do

| Key | Held by | Can | Cannot |
|---|---|---|---|
| **Session key** (function-call) | freelancer's browser, added with one wallet approval | call `create_invoice` and `cancel` on the Dues contract, zero deposit; 0.01 NEAR gas allowance that relayed calls never touch | move NEAR or USDC, attach a deposit, call any other contract |
| **Pull key** (function-call) | a scheduler, granted by the client | call `pull` on the Dues contract, which pays the agreed monthly amount to the named freelancer once it is due | withdraw escrow, cancel, transfer anything; revoke it from the wallet at any time |
| **Relayer keys** (3, full access on the relayer's own account) | Dues relayer | pay gas for requests that pass the policy above | sign for any user; they only wrap delegate actions users signed |
| **Watcher** (`watcher_id` in the contract) | Dues watcher | `mark_paid` / `mark_refunded` after checking the 1Click swap pays this freelancer, in USDC, in full; record tx hashes after reading the transaction and the contract's own event | move any funds: 1Click pays the freelancer directly, and escrow only moves through `pull` and `withdraw_remaining` |
| **Contract account** (`dues.testnet`) | the deployer key, until `pnpm lock:testnet` deletes it | deploy code | after locking: nothing; code upgrades then go only through the owner's `update_contract` |
| **Owner** (`dues-owner.testnet`) | the author | rotate the watcher, transfer ownership, upgrade the code | touch invoices, escrow or payments |

The freelancer's wallet signs exactly one transaction ever: adding the session key. Meteor and Intear (the wallets used here, through NEAR Wallet Selector) cannot sign delegate actions, so the session key does that, and a function-call key cannot attach deposits, which is why USDC registration is done by the relayer directly.

## NEAR's role, concretely

- **NEAR Intents 1Click** turns "pay from any chain" into one quote and one deposit address, with refunds to the payer's own chain when something goes wrong.
- **Meta-transactions (NEP-366)** let the freelancer act without holding NEAR for gas; the relayer pays, but `predecessor_account_id` is still the freelancer, so the contract knows who created what.
- **Function-call access keys** make "can create invoices but cannot move money" and "can release this month's retainer and nothing else" enforceable by the protocol, not by our servers.
- **USDC on NEAR** (Circle, NEP-141) is what the freelancer receives; `ft_transfer_call` lets one transaction pay an invoice or fund escrow.
- **The contract** is the system of record: status, amounts, fees and every transaction hash live on-chain and are readable by anyone (`/dashboard/?account=…`).

## Run your own

| Command | What it does |
|---|---|
| `pnpm demo:dry` | full flow on a local sandbox, exits 0 when all 8 scenes pass |
| `pnpm sandbox` + `pnpm dev` | local chain, API and app to click through |
| `pnpm api` | the API on :3031 for a real network (reads `.env`) |
| `pnpm relayer`, `pnpm watcher` | each service on its own |
| `pnpm accounts:testnet`, `pnpm deploy:testnet`, `pnpm testnet:flow` | testnet accounts, deployment, one paid invoice |
| `CONFIRM_LOCK=yes pnpm lock:testnet` | deletes the contract account's own full-access key (checks `update_contract` is deployed first) |
| `pnpm deploy:web` | static app plus one serverless function for `/api` on Vercel; Vercel Cron calls `/api/cron/pull` daily |

Configuration: [.env.example](.env.example). Without relayer or watcher keys the API answers 503 for that part and the app stays usable read-only.

## Repository layout

```
contracts/dues        Rust contract (near-sdk 5.30): invoices, ledger, direct pay, retainer escrow; sandbox tests in tests/flow.rs
contracts/mock-usdc   6-decimal NEP-141 for the sandbox
packages/core         shared types, money, 1Click client, status mapping, CSV, NEAR helpers (relay, meta-tx signing)
packages/widget       <dues-checkout> web component and React wrapper
relayer               meta-transaction relayer and its policy
watcher               1Click status watcher, client-tx verification, retainer scheduler
api                   one router for relayer, watcher and cron; local server and Vercel function
app                   Next.js app: landing, /new, /i/?id=N hosted invoice page, /dashboard
scripts               demo:dry, sandbox, testnet accounts / deploy / flow, deploy-web
fixtures/1click       token list, a recorded dry quote, recorded status sequences (success, refunded, failed)
deployments           testnet.json: contract id and every deployment transaction; mainnet.json: the $2 payment
docs/PROBLEM.md       the problem, with sources
```

## Business model

Proposed: the widget and contract are free and open source. Revenue comes from the hosted parts: a small app fee on any-chain payments carried in the 1Click quote itself (1Click quotes support app fees), paid by the payer and shown before they pay; and a paid plan for businesses that want their own relayer, branded invoice pages, multi-currency reports and accountant exports. Direct USDC-on-NEAR payments stay free. Customers: freelancers and small studios paid from abroad, and any merchant that wants one checkout button for every chain.

## Sponsors and bounties

None. Everything runs on free infrastructure: NEAR testnet, Circle testnet USDC, the NEAR testnet faucet helper, FastNEAR RPC, NearBlocks, 1Click's public API (dry quotes, and the one $2 mainnet payment, paid by the author), Meteor and Intear wallets.

## Libraries and AI-generated code

Contract: `near-sdk`, `near-contract-standards`; tests: `near-workspaces`, `tokio`, `serde_json`, `anyhow`. TypeScript: `near-api-js` (7.4, and 6.5.1 only for the Meteor wallet SDK), `near-sandbox`, `fastify`, `@fastify/cors`, `borsh`, `qrcode`, `tsx`, `typescript`, `vitest`, `esbuild`. App: `next`, `react`, `tailwindcss`, `@near-wallet-selector/core`, `@near-wallet-selector/meteor-wallet`, `@near-wallet-selector/intear-wallet`, `@near-js/crypto`, Inter and JetBrains Mono (Google Fonts, OFL). Build: `cargo-near`.

Much of the code in this repository was written with AI coding assistants under the author's direction, and was reviewed and tested by the author.

## Other entry

The author's other entry in this hackathon is **Chaperone**. The two projects are independent and share no code.

## License

MIT, see [LICENSE](LICENSE).
