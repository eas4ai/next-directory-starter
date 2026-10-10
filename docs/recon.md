# next-geo-cache-policy reconciliation

- **Exists:** `src/proxy.ts` negotiates the current public listing or article
  Markdown for `Accept`, the documented user agents, and `.md` URLs. It uses
  `publishedListingBySlug` and `publishedArticleBySlug`, which are also used by
  the HTML pages. The direct production check passed every request signal,
  eligibility, revision, and withdrawal case when the old HTML `Vary`
  assertion was temporarily omitted.
- **Exists:** `src/lib/markdown-twins.ts` sets `text/markdown`, `noindex`,
  `no-store`, `nosniff`, and `Vary: Accept, User-Agent` for negotiated and
  explicit Markdown responses.
- **Contradicted:** the original SEO-011 contract required the HTML detail
  responses to send `Vary: Accept, User-Agent`. The bound production receipt
  `9cc545570c0a5fae12e3a23c998800fa9aa550b8` failed because Next.js 16
  replaced that header with its App Router variation. The installed
  `node_modules/next/dist/build/templates/app-page-runtime.js` sets `Vary`
  after the proxy and configuration headers. Next.js issue
  `vercel/next.js#85852` documents the same behavior.
- **Exists:** production HTTP observations of both listing and article HTML
  detail responses showed `Cache-Control: private, no-cache, no-store,
  max-age=0, must-revalidate`. The developer approved requiring noncached HTML
  and `Vary` on Markdown in answer
  `ef12ed1c8cd5884005de182c4ca22c536be38ef6`.
- **Documented:** `README.md` now states the successor cache policy: both
  detail representations are noncached, and Markdown varies on `Accept` and
  `User-Agent`.
- **Exists:** the successor mechanism failed on a deliberate missing Markdown
  `Vary` header in receipt `af40867ea1047ea45bcfc369a83e6b310402139a`
  and passed with the header restored in receipt
  `2681fdd607c8abddcd1acef97a5ceb4867e3d884`.
