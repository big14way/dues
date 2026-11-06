# Why Dues exists

## The short version

A freelancer in Lagos who works for a client in London or Austin has two problems. The first is getting paid at all: payment rails into Nigeria are expensive, slow and fragile. The second is that the client already holds money in some form (a card, USDC on Base, SOL, USDT on Tron) and does not want to learn a new one to settle an invoice. Dues fixes both with one link. The client pays from whatever they hold; the freelancer receives exactly the invoiced amount in USDC on NEAR, with a status page and a CSV a bookkeeper can read.

## What it costs today

| Fact | Source |
|---|---|
| Sub-Saharan Africa is the most expensive region in the world to send money to. The average cost of sending $200 there was **7.9%** in Q2 2023, with some corridors charging up to 36% for a $200 transfer. It has been the costliest region for 15 years running. | World Bank Remittance Prices Worldwide, reported by [BusinessDay, Jan 2024](https://businessday.ng/news/article/nigeria-ssa-peers-record-highest-remittance-costs-for-15th-straight-year/); database at [remittanceprices.worldbank.org](https://remittanceprices.worldbank.org/) |
| Nigeria receives about **38%** of all remittance flows to Sub-Saharan Africa. | Same report, [BusinessDay](https://businessday.ng/news/article/nigeria-ssa-peers-record-highest-remittance-costs-for-15th-straight-year/) |
| Until **January 27, 2026**, PayPal accounts in Nigeria could only send money, not receive it. Inbound PayPal now works only for accounts linked to one local partner, Paga. | [Nairametrics, Jan 27 2026](https://nairametrics.com/2026/01/27/paypal-goes-live-in-nigeria-through-paga-enabling-global-payments-and-local-withdrawals/), [Techpoint Africa](https://techpoint.africa/news/paga-paypal-partner-in-nigeria/) |
| Nigerian freelancers report multi-day settlement, withdrawal limits tied to domiciliary account rules, poor FX rates, and accounts restricted for months. One designer could not withdraw PayPal earnings for six months. The naira lost more than 40% against the dollar between 2023 and 2024. | [Nairametrics, Feb 24 2026](https://nairametrics.com/2026/02/24/why-nigerian-gig-workers-prefer-stablecoin-payments-to-the-naira/) |
| A stablecoin report by BVNK with Coinbase and Artemis found Nigerian respondents overwhelmingly prefer being paid in stablecoins over naira; transfers settle in minutes for under $1. | [Nairametrics, Feb 24 2026](https://nairametrics.com/2026/02/24/why-nigerian-gig-workers-prefer-stablecoin-payments-to-the-naira/) |

So the money already wants to move as dollars on a chain. What is missing is the invoice around it: an amount, a due date, line items, a client who can pay from any wallet, a clear paid / pending / refunded status, and records an accountant accepts.

## Who gets hurt, and how

*Illustrative scenario, built from the reports above.*

Ada is a product designer in Lagos on a $1,500 monthly retainer with a startup in Berlin. Every month she sends a PDF, waits, chases, and then loses a slice of the payment to the route it takes and another slice to the exchange rate. The client's finance person is happy to pay in USDC, but they hold it on Base, and Ada's wallet is on another chain. Twice the payment arrived short and nobody could say why. Her accountant wants one line per payment with a date, an amount, a fee and a reference; she sends screenshots.

## What Dues changes

- **The client pays from what they hold.** A NEAR Intents 1Click quote with `EXACT_OUTPUT` means Ada receives exactly $1,500.00 in USDC on NEAR. The conversion cost is shown to the client before they pay and lands on their side.
- **Ada never pays gas.** One wallet approval adds a key that can only create and cancel her invoices. After that, a relayer pays every network fee, and it pays for nothing except calls to the Dues contract.
- **Retainers do not need chasing.** A client on NEAR can prepay months into escrow. On each due date one month is released to Ada, and only to Ada. The client can stop at any time and take back the rest.
- **The status is a fact, not a promise.** Paid means USDC reached Ada's account; the NEAR transaction and the origin-chain transaction are linked on the invoice. Refunded means the payer got their money back and nothing counts as income.
- **The books close.** Export CSV: one row per payment with date, invoice, client, amount, fee, transaction link and status.

## The founder's wishlist

NEAR co-founder Illia Polosukhin listed four things he wants built on NEAR ([post on X](https://x.com/ilblackdragon/status/2118027843980366222)). The third is a universal checkout widget: any merchant or app adds a checkout button that lets the buyer pay through NEAR Intents from whichever wallet and blockchain they use.

Dues ships that as `<dues-checkout>`, one script tag or one React component, and uses invoices and retainers for freelancers as the first product built on it. The widget is the general piece; the invoices prove it works for real money.
