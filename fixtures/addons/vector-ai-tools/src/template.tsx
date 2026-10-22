import type { PublicTemplateDefinition } from "@/lib/public-template-sdk";
import {
  TemplateContentImage, TemplateLink, TemplateListingCard, TemplateMarkdown,
  TemplatePagination, TemplateProfileValues,
} from "@/components/public-template-primitives";

const vectorTemplate = {
  id: "vector-ai-tools",
  name: "VECTOR AI Tools",
  renderers: {
    header({ site, navigation, appearanceControl }) {
      return <header className="vector-header">
        <nav className="vector-nav" aria-label="Main navigation">
          <TemplateLink href="/" className="vector-brand" aria-label={`${site.name} home`}>
            <img src={site.logoUrl ?? "/addons/vector-ai-tools/vector-mark.svg"}
              alt="" width="120" height="40" />
            <span className="vector-brand-copy">
              <strong>{site.name}</strong>
              <span>VECTOR AI INDEX</span>
            </span>
          </TemplateLink>
          <div className="vector-nav-links">
            <TemplateLink href="/listings">Explore</TemplateLink>
            <TemplateLink href="/compare">Compare</TemplateLink>
            <TemplateLink href="/listings?sort=vector-ai-tools.ai-tools.launch-date%3Adesc">
              Launches
            </TemplateLink>
            {navigation.filter(({ href }) => href === "/owner/listings").map((item) =>
              <TemplateLink key={item.href} href={item.href} className="vector-action-link">
                {item.label} ↗
              </TemplateLink>)}
            {appearanceControl}
          </div>
        </nav>
      </header>;
    },
    home({ site }) {
      return <main className="vector-home">
        <section className="vector-hero">
          <div className="vector-kicker">THE AI TOOL INDEX / VERIFIED PRODUCT FACTS</div>
          <h1>Discover tools that<br />actually fit your stack.</h1>
          <p>{site.description}</p>
          <form action="/listings" method="get" className="vector-search">
            <label htmlFor="vector-home-query" className="sr-only">Search AI tools</label>
            <input id="vector-home-query" name="q"
              placeholder="Search models, tools, and workflows" />
            <button type="submit">Search ↗</button>
          </form>
          <div className="vector-hero-actions">
            <TemplateLink href="/listings">Explore the index</TemplateLink>
            <TemplateLink href="/compare">Compare tools</TemplateLink>
          </div>
        </section>
        <section className="vector-home-grid" aria-label="VECTOR product capabilities">
          <article><span>01 / DISCOVER</span><h2>Filter the facts.</h2>
            <p>Pricing, free tiers, platforms, integrations, source status, and launch signals.</p></article>
          <article><span>02 / COMPARE</span><h2>Keep context aligned.</h2>
            <p>Choose two to four eligible tools and inspect every current public field.</p></article>
          <article><span>03 / VERIFY</span><h2>Know what was checked.</h2>
            <p>Mint signals identify operator-verified launch facts and nothing else.</p></article>
        </section>
        <section className="vector-diagram">
          <img src="/addons/vector-ai-tools/diagrams/stack-map.svg" width="760" height="220"
            alt="Discover, compare, verify, and launch workflow" />
        </section>
      </main>;
    },
    card({ listing, fields, mediaAssets, highlighted, compareControl }) {
      const known = new Set(["arc-forge", "pixel-flow", "signal-lab", "codepilot-local",
        "briefly", "voice-mesh", "data-lens", "agent-relay", "shadow-preview"]);
      const mark = known.has(listing.slug)
        ? `/addons/vector-ai-tools/marks/${listing.slug}.svg`
        : "/addons/vector-ai-tools/vector-mark.svg";
      const rawPrice = listing.profileValues["vector-ai-tools.ai-tools.starting-price"];
      const money = rawPrice && typeof rawPrice === "object"
        ? rawPrice as { amountMinor?: unknown; currency?: unknown } : undefined;
      const amount = money?.amountMinor;
      const currency = money?.currency;
      const formatted = typeof amount === "number" && typeof currency === "string"
        ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100)
        : undefined;
      const price = typeof amount === "number" && amount === 0 ? "Free"
        : formatted ? `From ${formatted}`
          : listing.profileValues["vector-ai-tools.ai-tools.pricing-model"] === "enterprise"
            ? "Contact sales" : "Price unavailable";
      return <article className="vector-tool-card">
        <div className="vector-card-top">
          <img src={mark} alt="" width="52" height="52" />
          <div><span>{listing.category}</span>
            <h2><TemplateLink href={`/listings/${listing.slug}`}>{listing.name}</TemplateLink></h2>
          </div>
        </div>
        <p>{listing.summary}</p>
        <div className="vector-fact-row"><strong>{price}</strong>
          {listing.profileValues["vector-ai-tools.ai-tools.free-tier"] === true && <span>Free tier</span>}
          {listing.profileValues["vector-ai-tools.ai-tools.open-source"] === true && <span>Open source</span>}
          {listing.profileValues["vector-ai-tools.ai-tools.verified-launch"] === true &&
            <span className="vector-verified">● Verified</span>}
        </div>
        <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets}
          placements={["badge"]} />
        {highlighted && <span className="vector-featured">Featured</span>}
        {compareControl}
      </article>;
    },
    directory(value) {
      const Card = value.slots?.card ?? TemplateListingCard;
      const launches = [...value.listings].filter((listing) =>
        listing.profileValues["vector-ai-tools.ai-tools.launch-status"] === "new").sort((left, right) =>
        String(right.profileValues["vector-ai-tools.ai-tools.launch-date"]).localeCompare(
          String(left.profileValues["vector-ai-tools.ai-tools.launch-date"]))).slice(0, 3);
      return <main className="vector-directory">
        <section className="vector-directory-intro">
          <div className="vector-kicker">VECTOR / DIRECTORY</div>
          <h1>Find the right model<br />for the work.</h1>
          <p>{value.description}</p>
        </section>
        <section className="vector-launches" aria-labelledby="vector-launches-heading">
          <div className="vector-section-heading"><div>
            <span>NEW THIS WEEK</span><h2 id="vector-launches-heading">Latest launches</h2>
          </div><TemplateLink href="/listings?sort=vector-ai-tools.ai-tools.launch-date%3Adesc">
            View launch index ↗
          </TemplateLink></div>
          <div className="vector-launch-grid">{launches.map((listing) =>
            <TemplateLink key={listing.slug} href={`/listings/${listing.slug}`}>
              <strong>{listing.name}</strong><span>{listing.category}</span>
              {listing.profileValues["vector-ai-tools.ai-tools.verified-launch"] === true &&
                <em>● Verified</em>}
            </TemplateLink>)}</div>
        </section>
        {value.featured.length > 0 && <section className="vector-sponsored"
          aria-labelledby="vector-sponsored-heading">
          <div className="vector-section-heading"><div><span>FEATURED PLACEMENTS</span>
            <h2 id="vector-sponsored-heading">Sponsored tools</h2></div></div>
          <div className="vector-card-grid">{value.featured.map((listing) =>
            <Card key={listing.slug} listing={listing} fields={value.fields}
              mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} highlighted />)}</div>
        </section>}
        <section className="vector-discovery" aria-label="Discover AI tools">
          <aside><div className="vector-filter-heading">FILTER THE INDEX</div>{value.facets}</aside>
          <div className="vector-results">
            <div className="vector-section-heading"><div><span>DISCOVERY RESULTS</span>
              <h2>{value.total} {value.total === 1 ? "tool" : "tools"}</h2></div>
              <span>Server-rendered / current filters</span></div>
            {value.listings.length === 0
              ? <div className="vector-empty"><h3>No matching tools.</h3>
                <p>Clear a filter or broaden the search to inspect the full index.</p>
                <TemplateLink href="/listings">Clear filters</TemplateLink></div>
              : <form action="/compare" method="get" className="vector-compare-form">
                <div className="vector-compare-bar"><span>Select 2–4 tools</span>
                  <button type="submit">Compare selected ↗</button></div>
                <div className="vector-card-grid">{value.listings.map((listing) =>
                  <div key={listing.slug} data-vector-result={listing.slug}>
                    <Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets}
                      iconLibrary={value.iconLibrary} compareControl={<label className="vector-compare-choice">
                        <input type="checkbox" name="tool" value={listing.slug} />
                        <span>Add to comparison</span>
                      </label>} />
                  </div>)}</div>
              </form>}
            <TemplatePagination value={value.pagination} />
          </div>
        </section>
      </main>;
    },
    listing(value) {
      const known = new Set(["arc-forge", "pixel-flow", "signal-lab", "codepilot-local",
        "briefly", "voice-mesh", "data-lens", "agent-relay", "shadow-preview"]);
      const mark = known.has(value.listing.slug)
        ? `/addons/vector-ai-tools/marks/${value.listing.slug}.svg`
        : "/addons/vector-ai-tools/vector-mark.svg";
      const verified = value.listing.profileValues["vector-ai-tools.ai-tools.verified-launch"] === true;
      return <main className="vector-detail">
        <TemplateLink href="/listings" className="vector-back">← Back to the index</TemplateLink>
        <header><img src={mark} alt="" width="72" height="72" /><div>
          <span>{value.listing.category}</span><h1>{value.listing.name}</h1>
          <p>{value.listing.summary}</p>
        </div>{verified && <strong className="vector-verified">● Verified launch</strong>}</header>
        <div className="vector-detail-grid">
          <article><div className="vector-kicker">PRODUCT BRIEF</div>
            <div className="vector-description"><TemplateMarkdown
              source={value.listing.description} /></div>
            {value.image && <TemplateContentImage asset={value.image} />}
            <div className="vector-detail-actions">
              <a href={value.listing.url} target="_blank" rel="noopener noreferrer">Visit product ↗</a>
              <TemplateLink href="/listings">Choose tools to compare</TemplateLink>
              <a href={value.markdownHref} type="text/markdown" rel="alternate">Markdown</a>
            </div>
          </article>
          <aside><div className="vector-kicker">CURRENT FACTS</div>
            <TemplateProfileValues fields={value.fields} listing={value.listing}
              mediaAssets={value.mediaAssets} /></aside>
        </div>
      </main>;
    },
    empty({ message }) {
      return <div className="vector-empty"><h3>No matching tools.</h3><p>{message}</p>
        <TemplateLink href="/listings">Clear filters</TemplateLink></div>;
    },
    pagination({ value }) {
      return <TemplatePagination value={value} />;
    },
    comparison({ listings, fields, mediaAssets, message }) {
      const known = new Set(["arc-forge", "pixel-flow", "signal-lab", "codepilot-local",
        "briefly", "voice-mesh", "data-lens", "agent-relay", "shadow-preview"]);
      return <main className="vector-comparison">
        <TemplateLink href="/listings" className="vector-back">← Choose tools</TemplateLink>
        <div className="vector-kicker">SIDE-BY-SIDE / PUBLIC FACTS</div>
        <h1>Compare your shortlist.</h1>
        <p>Every value below comes from the current eligible public record.</p>
        {message && <div className="vector-compare-message" role="status">{message}</div>}
        {listings.length > 0 && <div className="vector-table-wrap"><table className="vector-compare-table">
          <thead><tr><th scope="col">Fact</th>{listings.map((listing) => {
            const mark = known.has(listing.slug)
              ? `/addons/vector-ai-tools/marks/${listing.slug}.svg`
              : "/addons/vector-ai-tools/vector-mark.svg";
            return <th scope="col" key={listing.slug}><img src={mark} alt="" width="52" height="52" />
              <TemplateLink href={`/listings/${listing.slug}`}>{listing.name}</TemplateLink></th>;
          })}</tr></thead>
          <tbody>
            <tr><th scope="row">Summary</th>{listings.map((listing) =>
              <td key={listing.slug} data-tool={listing.name}>{listing.summary}</td>)}</tr>
            <tr><th scope="row">Category</th>{listings.map((listing) =>
              <td key={listing.slug} data-tool={listing.name}>{listing.category}</td>)}</tr>
            {fields.map((field) => <tr key={field.key}><th scope="row">{field.label}</th>
              {listings.map((listing) => <td key={listing.slug} data-tool={listing.name}>
                {field.key in listing.profileValues
                  ? <TemplateProfileValues fields={[field]} listing={listing} mediaAssets={mediaAssets} />
                  : <span className="vector-unavailable">Not disclosed</span>}
              </td>)}</tr>)}
          </tbody>
        </table></div>}
      </main>;
    },
    footer({ navigation }) {
      return <footer className="vector-footer"><div><strong>VECTOR/</strong>
        <span>Find the right model for the work.</span></div><nav aria-label="Footer navigation">
          {navigation.map((item) => <TemplateLink key={item.href} href={item.href}>
            {item.label}
          </TemplateLink>)}</nav></footer>;
    },
  },
} satisfies PublicTemplateDefinition;

export default vectorTemplate;
