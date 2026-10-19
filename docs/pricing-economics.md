# Scopeflow pricing and economics

Prepared 19 October 2026. This replaces the 1 October note. The prices below are the ones the app enforces. They are GST-inclusive rupee prices for an Indian freelancer or a small studio, with a US dollar price for everyone else. Razorpay (UPI and cards) is the India checkout. Stripe is the US dollar checkout. Scopeflow never holds the client’s project money; a plan only pays for Scopeflow itself.

Comparable public prices were read on 18–19 October 2026. They are references for where a scope-and-approval tool should sit, not a quote for this merchant account.

## Who this is for

The buyer is one freelancer, or a studio of a few people, mostly in India, who sends a scope, gets a clear yes, and keeps the record. They do not run hundreds of projects. A useful free tier is a few live jobs with client review, invoices and a certificate. Paid plans add an assistant, reminders and retainers, then seats.

## What the limits count

| | Free | Freelancer (`pro`) | Studio (`agency`) |
|---|---:|---:|---:|
| Active projects | 3 | 15 | 40 |
| Clients | 8 | 40 | 120 |
| Seats, including the owner | 1 | 1 | 5 |
| Versions per project | 20 | 50 | 80 |
| Record entries per project | 40 | 200 | 400 |
| Price per month | ₹0 | ₹799 | ₹2,499 |
| Price per year (10×, two months free) | ₹0 | ₹7,990 | ₹24,990 |
| US dollar month / year | $0 | $9 / $90 | $29 / $290 |
| Founding month | — | ₹399 | ₹1,299 |
| Founding year | — | ₹3,990 | ₹12,990 |
| Founding US dollar month / year | — | $5 / $50 | $15 / $150 |

Archived projects do not count. A client is a distinct name on an active project. Yearly is exactly ten times monthly. Founding is about half of list (Freelancer is half; Studio is ₹1,299 against ₹2,499). Early beta, the server default until a paid plan exists, is wider than these cards and is not for sale. Solo stays a hidden test arm and is not on the page.

Free includes client review, change orders, a personal rate card, invoices and GST documents, export, the approval certificate, and the optional one-time code (off unless the project turns it on). It does not include AI drafting, the API or AI assistants, automatic reminders, retainers, or seats.

Freelancer adds AI drafting, the API and assistants, automatic reminders, and retainers. Studio adds those, plus five seats (owner, manager, member, finance), a shared rate card, and team activity.

## Founding members

The first 100 paid Freelancer or Studio subscriptions that start on or before 30 June 2027 (23:59:59.999 UTC) pay the founding price. The price stays for 24 months from the start, while the subscription is active or halted inside the 7-day grace. Cancelling or letting it lapse ends the founding price. A later subscription pays the list price. A pending checkout reserves a seat so the hundredth place is not sold twice; an abandoned or cancelled checkout frees it.

## Why these numbers

Scopeflow is narrower than a full client CRM. It is the scope, the approval and the record. It should cost less than a proposals-and-contracts suite, and about as much as a basic Indian books subscription for one person.

- [Zoho Books India](https://www.zoho.com/in/books/pricing/) lists Standard at ₹749 per organisation per month when billed annually, and Professional at ₹1,499 with 5 users. Freelancer at ₹799 a month (₹7,990 a year, about ₹666 a month) sits next to Standard. Studio at ₹2,499 a month (₹24,990 a year, about ₹2,082 a month) is above Professional because it includes assistants and seats, and still far below a US client-ops suite.
- [Bonsai](https://www.hellobonsai.com/pricing) (the 2026 reshuffle, as reported by [Client Kit on 8 October 2026](https://www.clientkit.com/blog/honeybook-vs-bonsai) and Jobbers) is about $15 / $25 / $39 / $59 a month for Basic, Essentials, Premium and Elite, with annual prices lower. Essentials is the tier that includes proposals, contracts and invoicing. Freelancer at $9 a month is under that Essentials price. Studio at $29 matches Bonsai’s annual Premium band and stays under HoneyBook.
- [HoneyBook](https://www.honeybook.com/pricing) Starter is about $36 a month or $29 billed annually, Essentials about $59 / $49, Premium about $109. HoneyBook does not take UPI. Scopeflow’s dollar prices stay under Starter’s monthly price for one person and under Essentials for a studio.
- Better Proposals Starter is about $19 a month or $13 billed annually. PandaDoc Starter is about $35 a month or $19 per user billed annually. Proposify Basic is about $29 / $19. Qwilr Business is about $39 / $35. Those are proposal documents, not an approval record with a certificate.
- Indian billing tools are cheaper because they are accounting, not scoping: Refrens has a free starter, myBillBook is often near ₹250 a month when billed yearly, Vyapar is about ₹3,399 a year for desktop, and TallyPrime Silver is about ₹750 a month. Scopeflow is not trying to replace them.

Razorpay’s public India pricing is a percentage of the charge plus GST on the fee, and UPI is cheaper than cards. The exact schedule depends on the merchant account, so this note does not treat a blog’s fee table as the founder’s quote. At ₹799, even a 3% fee leaves most of the rupee. At a $1 plan it would not. The old $1 and $4 experiments are retired.

The $0.50 a month operating reserve in the October note is still only an assumption. It is not a measured hosting or support cost.

## Needs owner

Create these in the Razorpay dashboard (subscriptions, GST-inclusive, amount in paise) and put each plan id in the named variable. Create the Stripe prices in US cents the same way. Checkout refuses to sell a price whose id is missing. Keys that were already required stay required: `RAZORPAY_BILLING_KEY_ID`, `RAZORPAY_BILLING_KEY_SECRET`, `RAZORPAY_BILLING_WEBHOOK_SECRET`, and the Stripe secret and webhook secret.

| Env variable | Amount |
|---|---:|
| `RAZORPAY_BILLING_PLAN_PRO_MONTH` | ₹799 (79900 paise) |
| `RAZORPAY_BILLING_PLAN_PRO_YEAR` | ₹7,990 (799000 paise) |
| `RAZORPAY_BILLING_PLAN_AGENCY_MONTH` | ₹2,499 (249900 paise) |
| `RAZORPAY_BILLING_PLAN_AGENCY_YEAR` | ₹24,990 (2499000 paise) |
| `RAZORPAY_BILLING_PLAN_PRO_MONTH_FOUNDING` | ₹399 (39900 paise) |
| `RAZORPAY_BILLING_PLAN_PRO_YEAR_FOUNDING` | ₹3,990 (399000 paise) |
| `RAZORPAY_BILLING_PLAN_AGENCY_MONTH_FOUNDING` | ₹1,299 (129900 paise) |
| `RAZORPAY_BILLING_PLAN_AGENCY_YEAR_FOUNDING` | ₹12,990 (1299000 paise) |
| `STRIPE_BILLING_PRICE_PRO_MONTH` | $9 (900 cents) |
| `STRIPE_BILLING_PRICE_PRO_YEAR` | $90 (9000 cents) |
| `STRIPE_BILLING_PRICE_AGENCY_MONTH` | $29 (2900 cents) |
| `STRIPE_BILLING_PRICE_AGENCY_YEAR` | $290 (29000 cents) |
| `STRIPE_BILLING_PRICE_PRO_MONTH_FOUNDING` | $5 (500 cents) |
| `STRIPE_BILLING_PRICE_PRO_YEAR_FOUNDING` | $50 (5000 cents) |
| `STRIPE_BILLING_PRICE_AGENCY_MONTH_FOUNDING` | $15 (1500 cents) |
| `STRIPE_BILLING_PRICE_AGENCY_YEAR_FOUNDING` | $150 (15000 cents) |

Hosting is unchanged. Turning billing on in production is still the owner’s call, after these ids exist.
