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

## Articles

An administrator can edit articles at `/admin/articles`. To give a separate account article editing access without administrator controls, provision it against the same database:

```sh
npm run account:provision -- --email editor@example.com --name "Editor" --role editor
```

Editors sign in through `/owner/sign-in` and follow **Edit articles** to save drafts or publish and unpublish articles. Published articles appear at `/articles`; drafts return a missing response on public routes. Article bodies are plain text and preserve line breaks.

Administrators manage listing categories and article tags at `/admin/taxonomy`. A newly added category appears in the directory filter even before it has listings. Rename carries existing listings and pending owner proposals to the new category. Names in use must be removed from content before deletion. Editors can assign an existing tag to an article using the comma-separated tag field.

The article RSS feed is available at `/feed.xml`. It includes published articles and updates when an editor publishes or unpublishes one.

## Publishing plans and checkout

Administrators configure test or live free, one-time, monthly, and annual plans at `/admin/plans`, including price, currency, placement, and availability. Set `BILLING_CHECKOUT_MODE=test` or `live` for the plans owners should see; existing paid plans migrate to the mode of the configured Stripe key. Moderator approval still publishes an ordinary listing for free. An owner can select a free plan without a payment provider. Monthly and annual terms are visible, with checkout held until recurring payments are connected.

One-time plans continue through Stripe-hosted Checkout when `STRIPE_SECRET_KEY` is set. Each purchase saves the accepted plan name, description, mode, amount, currency, duration, and placement; later plan edits do not change those terms. A return to the site is only a receipt of browser navigation; payment confirmation comes from the signed webhook.

If an administrator changes a plan while an owner has its page open, Checkout asks the owner to refresh and review the new terms. A retry after a connection or database error keeps the same pending purchase and Stripe idempotency key for that attempt.

Configure a Stripe webhook destination at `https://your-site.example/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded`. Put that destination's signing secret in `STRIPE_WEBHOOK_SECRET`. The handler verifies the raw body signature and matching purchase details before granting a time-limited entitlement. Repeated events have no additional effect; a verified full refund revokes the entitlement. Test mode and live mode have separate API keys and webhook secrets.

## Deploying

Set `BETTER_AUTH_URL` and `SITE_URL` to the site's public HTTPS origin. Set `BETTER_AUTH_SECRET` to a unique secret and `DATABASE_URL` to a writable, persistent SQLite file, then run `npm run db:migrate` and provision an administrator using the same environment as the running application. Back up the SQLite file. The ignored `.runtime/directory.db` default is intended for local development; production storage must survive builds and deployments.

Run `npm run build` and `npm run start` to serve the production build. Change the sample records in `fixtures/sample-listings.json` before seeding a fresh database, or use `/admin/catalog` to add your own listings. Records marked `draft` stay off public pages. Existing databases keep their content when the seed file changes.
