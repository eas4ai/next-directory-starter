# Directory Starter

A Next.js App Router starter for a server-rendered link directory. It includes sample public listings, per-page metadata, and an administrator-only shadcn/ui preset editor. Authentication uses Better Auth and site settings use SQLite.

## First run

Use Node.js 22.12 or newer and npm. From a fresh clone:

```sh
npm ci
cp .env.example .env.local
```

Edit `.env.local`. Set `BETTER_AUTH_SECRET` to a unique value from `openssl rand -base64 32`. Keep `BETTER_AUTH_URL` and `SITE_URL` equal to the URL at which you will open the site. The example values work for local development at `http://localhost:3000`.

Set `RESEND_API_KEY` and `RESEND_FROM` using a verified Resend sending domain. Public account creation sends a verification link through Resend and cannot sign the new account in until the link is used. Configure the sender before opening public registration. Account holders can request password recovery from `/owner/forgot-password`; a completed reset revokes their earlier sessions.

Set `SITE_NAME` and `SITE_DESCRIPTION` to identify your directory. Set `SITE_LOGO_URL` and `SITE_ICON_URL` to site-relative paths or HTTP(S) asset URLs. Put site-relative assets in `public/` and refer to them with paths such as `/brand/logo.svg`. These settings change the public header and page metadata without editing application code.

Initialize the database, seed sample listings, and create the first administrator:

```sh
npm run db:migrate
npm run db:seed
npm run account:provision -- --email you@example.com --name "Site administrator"
npm run dev
```

The provisioning command prompts for a password. Open [the administrator sign-in page](http://localhost:3000/admin/sign-in), sign in with that account, then open `/admin/theme` to preview and save a preset or `/admin/catalog` to create and publish listings. Public sign-ups receive the regular user role and cannot access the editors. Do not use `--force` for routine provisioning.

The sample seed is repeatable and leaves existing listings unchanged. The public directory supports `q`, `category`, and `page` URL parameters and shows at most 12 listings per page. Draft and suspended listings are absent from public pages.

## Owner submissions and review

Owners create an account or sign in at `/owner/sign-in`. Their private workspace at `/owner/listings` lets them save a draft, submit it, and propose changes to an approved listing. A submitted snapshot stays in review while the approved version remains public. Owners cannot read or edit another owner's private work.

Verified accounts can also request a single-use email sign-in link from `/owner/sign-in`. Requesting one never registers an unknown address.

Administrators can suspend and reinstate accounts at `/admin/accounts`. Suspension revokes active sessions, blocks new sign-ins, and hides that account's approved listings from public pages and the sitemap. Reinstatement restores eligible listings. The final active administrator cannot be suspended. Each status change records the administrator and time in `/admin/audit`.

The first administrator can review submissions at `/admin/review`. To create a moderator account with review and suspension access but without general administrator access, run the provisioning command against the same database:

```sh
npm run account:provision -- --email moderator@example.com --name "Moderator" --role moderator
```

The command prompts for a password and asks for confirmation if accounts already exist. Moderators sign in through `/owner/sign-in` and then open `/admin/review`. Every approval or rejection requires a reason; prior decisions remain in review history. The review view also lets a moderator suspend any published listing. A suspended listing immediately leaves public search and its detail route; its pending revision is rejected, and the owner cannot edit or resubmit it.

Moderation decisions and confirmed payment changes add a private notice to the affected owner's workspace. The latest 20 notices appear at `/owner/listings`. Each notice is written in the same database transaction as its moderation or payment change, so retries do not repeat it and a failed notice insert rolls back the change.

Run `npm run notifications:deliver -- --limit 10` from a scheduled job to send at most ten due owner notices through Resend per invocation (maximum 50). Delivery state and bounded retries live in SQLite, so a restart does not lose pending notices. `/admin/notifications` shows the latest delivery states and lets an administrator retry exhausted notices without repeating the moderation or payment operation. A send whose outcome remains unknown after the provider idempotency window needs inspection in Resend before an operator retries it.

## Articles

An administrator can edit articles at `/admin/articles`. To give a separate account article editing access without administrator controls, provision it against the same database:

```sh
npm run account:provision -- --email editor@example.com --name "Editor" --role editor
```

Editors sign in through `/owner/sign-in` and follow **Edit articles**. Article bodies and listing descriptions accept Markdown; raw HTML, executable links, and embedded remote images are not rendered. Editors can save an article revision, open its private preview, and publish it explicitly. Saving a revision of an already published article leaves the public version in place until publication; stale editor tabs are asked to refresh. Published articles appear at `/articles`; drafts return a missing response on public routes.

Administrators manage listing categories, article categories, and article tags separately at `/admin/taxonomy`. A newly added listing category appears in the directory filter even before it has listings. Rename carries existing listings and pending owner proposals to the new category. Names in use must be removed from content before deletion. Editors can assign an article category and existing tags to an article. Visitors can search published articles and browse article category and tag filters at `/articles`; each page contains at most 20 articles.

The article RSS feed is available at `/feed.xml`. It includes published articles and updates when an editor publishes or unpublishes one.

Listing owners and article editors can upload a JPEG, PNG, or WebP image in their private editor. Uploads are limited to 5 MiB and 4096 pixels per side, re-encoded as WebP, and stored in a private local directory. Set `MEDIA_DIR` to a persistent writable directory if it should differ from the default directory beside the SQLite file. Back up that directory with the database.

A draft image is available only through an authenticated private image URL. An approved listing or published article uses a separate public image URL. Uploading a replacement to a published item leaves the prior image public until the revision is approved or published. Suspending the listing or unpublishing the article immediately blocks the public image route; image responses are not cached.

## Publishing plans and checkout

Administrators configure test or live free, one-time, monthly, and annual plans at `/admin/plans`, including price, currency, placement, and availability. Set `BILLING_CHECKOUT_MODE=test` or `live` for the plans owners should see; existing paid plans migrate to the mode of the configured Stripe key. Moderator approval still publishes an ordinary listing for free. An owner can select a free plan without a payment provider. Paid one-time and recurring offers use provider-hosted checkout; NOWPayments is available for one-time offers only.

One-time plans continue through Stripe-hosted Checkout when `STRIPE_SECRET_KEY` is set. Each purchase saves the accepted plan name, description, mode, amount, currency, duration, and placement; later plan edits do not change those terms. A return to the site is only a receipt of browser navigation; payment confirmation comes from the signed webhook.

Set `BILLING_ENCRYPTION_KEY` to a persistent random 32-byte base64url value before saving billing providers. Administrators manage independent test and live Stripe, Paddle, and NOWPayments profiles at `/admin/billing`. API and webhook secrets are encrypted in SQLite, are never sent back to the browser, and cannot be recovered if the encryption key is lost. Profiles begin disabled; enabling one requires complete credentials, plus a price mapping for Stripe or Paddle. A configured Stripe profile controls Checkout for its mode. The legacy `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` environment pair remains a fallback only when no Stripe profile exists in the selected mode. Keep old webhook secrets configured while their payments may still settle, even if a profile is disabled or the active checkout mode changes.

If an administrator changes a plan while an owner has its page open, Checkout asks the owner to refresh and review the new terms. A retry after a connection or database error keeps the same pending purchase and Stripe idempotency key for that attempt.

Configure a Stripe webhook destination at `https://your-site.example/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`, and `charge.dispute.closed`. Put that destination's signing secret in `STRIPE_WEBHOOK_SECRET` when using legacy environment credentials. The handler verifies the raw body signature and matching purchase details before granting a time-limited entitlement. Repeated events have no additional effect; a verified full refund revokes the affected paid period. Test mode and live mode have separate API keys and webhook secrets.

For saved billing profiles, configure Paddle notifications at `/api/webhooks/paddle/test` or `/api/webhooks/paddle/live` for `transaction.completed`, `subscription.updated`, `subscription.canceled`, `adjustment.created`, and `adjustment.updated`; configure NOWPayments IPN callbacks at `/api/webhooks/nowpayments/test` or `/api/webhooks/nowpayments/live`. Set each profile's webhook secret to the matching destination secret. The handlers verify provider signatures before retaining evidence, and only matching provider, mode, purchase, price, amount, currency, and resource can create a paid period. Unpaid renewals add no time; scheduled cancellation preserves paid time; full refund and open dispute suspend the affected paid period, while partial refunds leave it intact. Public featured placement uses the selected billing mode and also requires a published, unsuspended listing. An unresolved verified event is retained for operator reconciliation; owner checkout returns alone never grant placement.

Owners can inspect pending, paid, disputed, refunded, expired, and canceled purchases at `/owner/billing`; Stripe and Paddle recurring purchases can request cancellation at the paid period's end. For missed or out-of-order events, run `npm run billing:reconcile -- --limit 10` to retry at most ten retained unresolved events. Add `--purchase PURCHASE_ID` to read an existing Stripe Checkout Session, Paddle transaction, or NOWPayments invoice payments and reconcile their settled state without starting checkout. If a provider created a checkout but its response was lost, use `--purchase PURCHASE_ID --resource PROVIDER_ID` with the resource ID from that provider's dashboard. Reconciliation reads that exact resource, verifies its purchase reference and accepted terms, and binds it only when settled evidence matches. Provider profiles remain usable for this read-only recovery when disabled for new checkout. NOWPayments invoice lookup requires the optional `NOWPAYMENTS_EMAIL` and `NOWPAYMENTS_PASSWORD` dashboard credentials in the operator environment; the command reports when they are absent. The limit is capped at 50, and provider reads are capped to one page per purchase.

## Deploying

Set `BETTER_AUTH_URL` and `SITE_URL` to the site's public HTTPS origin. Set `BETTER_AUTH_SECRET` to a unique secret and `DATABASE_URL` to a writable, persistent SQLite file, then run `npm run db:migrate` and provision an administrator using the same environment as the running application. Back up the SQLite file. The ignored `.runtime/directory.db` default is intended for local development; production storage must survive builds and deployments.

Run `npm run build` and `npm run start` to serve the production build. Change the sample records in `fixtures/sample-listings.json` before seeding a fresh database, or use `/admin/catalog` to add your own listings. Records marked `draft` stay off public pages. Existing databases keep their content when the seed file changes.
