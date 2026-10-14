# Parity expansion requested 2026-10-09

The finished 32-requirement starter covers the directory core but does not yet
match the shared workflows in `../suprnova-directory-starter` and
`../devlist.app`. The operator requested the shared missing workflows plus the
NOWPayments Node SDK. The Next.js/React/shadcn/ui stack remains the intended UI.

These are delivery groups, not a claim that their requirements are Agreed or
implemented. Each group enters the Sudus contract and receives its own
falsifiers before implementation.

| Order | Delivery group | Requested behavior |
| --- | --- | --- |
| 1 | Account access | Verified email, password recovery, existing-account magic links, suspension and reinstatement. Use email/password plus magic links, with no Google/GitHub OAuth in this pass. |
| 2 | Payment lifecycle | Free, one-time and recurring publishing plans; Stripe and Paddle, plus hosted NOWPayments through the official `@nowpaymentsio/nowpayments-sdk-nodejs`; separate test/live settings; authenticated events, owner payment status and bounded recovery for renewals, cancellation, refund and dispute. |
| 3 | Content and notifications | Bounded private listing/article image uploads and public approved media; safe Markdown with article preview, article search and taxonomy navigation; durable owner moderation and payment notifications. |
| 4 | SEO and operations | Editable site/content SEO and verification values, safe redirects and 404 report, eligible public Markdown pages, admin overview and finer permissions, visitor light/dark preference, MIT licensing and documented backup, restore and upgrade steps. |

DevList-specific claims, intake/discovery, AI tools, badges and supporters are
outside this expansion. The DevList visual design is also outside it: the
operator chose to keep the shadcn/ui design. Traffic reporting is not in the
shared implemented baseline of the two reference checkouts and is not claimed
as parity work here.
