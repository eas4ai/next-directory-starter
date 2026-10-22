import type {
  PublicTemplateDefinition, PublicTemplateHomeProps, PublicTemplateListing,
} from "@/lib/public-template-sdk";
import {
  TemplateContentImage, TemplateLink, TemplateListingCard, TemplateMarkdown,
  TemplatePagination, TemplateProfileValues,
} from "@/components/public-template-primitives";

const profile = "northstar-experts.experts";
const key = (suffix: string) => `${profile}.${suffix}`;
const values = (listing: PublicTemplateListing) => ({
  specialties: listing.profileValues["northstar-experts.experts.specialties"],
  sectors: listing.profileValues["northstar-experts.experts.sectors"],
  engagements: listing.profileValues["northstar-experts.experts.engagement-modes"],
  location: listing.profileValues["northstar-experts.experts.service-location"],
  experience: listing.profileValues["northstar-experts.experts.years-experience"],
  rate: listing.profileValues["northstar-experts.experts.rate"],
  availability: listing.profileValues["northstar-experts.experts.availability"],
  nextAvailable: listing.profileValues["northstar-experts.experts.next-available"],
  reviewed: listing.profileValues["northstar-experts.experts.credential-reviewed"],
  reviewedAt: listing.profileValues["northstar-experts.experts.credential-reviewed-at"],
  contactUrl: listing.profileValues["northstar-experts.experts.contact-url"],
  portraits: listing.profileValues["northstar-experts.experts.portraits"],
});
const label = (input: unknown) => typeof input === "string"
  ? input.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ")
  : "";
const firstChoice = (input: unknown) => Array.isArray(input) ? label(input[0]) : label(input);
const location = (input: unknown) => input && typeof input === "object" && "locality" in input &&
  typeof input.locality === "string" ? input.locality : "Remote";
const money = (input: unknown) => {
  if (!input || typeof input !== "object" || !("amountMinor" in input) || !("currency" in input) ||
      typeof input.amountMinor !== "number" || typeof input.currency !== "string") return "Rate on request";
  return `${new Intl.NumberFormat("en", { style: "currency", currency: input.currency,
    maximumFractionDigits: 0 }).format(input.amountMinor / 100)}/hr`;
};
const portraitId = (listing: PublicTemplateListing) => {
  const portraits = values(listing).portraits;
  if (typeof portraits === "string") return portraits;
  if (!Array.isArray(portraits) || portraits.length === 0) return undefined;
  const first = portraits[0];
  return first && typeof first === "object" && "value" in first && typeof first.value === "string"
    ? first.value : undefined;
};
const portrait = (listing: PublicTemplateListing,
  assets: PublicTemplateHomeProps["mediaAssets"]) => {
  const id = portraitId(listing);
  return id ? assets.get(id) : undefined;
};
const reviewed = (listing: PublicTemplateListing) => values(listing).reviewed === true;
const contactUrl = (listing: PublicTemplateListing) => {
  const value = values(listing).contactUrl;
  return typeof value === "string" ? value : listing.url;
};

const northstarTemplate = {
  id: "northstar-experts",
  name: "NORTHSTAR Experts Directory",
  supportedProfiles: [{ id: profile, range: "^1.0.0" }],
  renderers: {
    header({ site, navigation, appearanceControl }) {
      return <header className="northstar-header">
        <nav className="northstar-nav" aria-label="Main navigation">
          <TemplateLink href="/" className="northstar-brand" aria-label={`${site.name} home`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/addons/northstar-experts/northstar-mark.svg" alt="" width="42" height="42" />
            <span><strong>NORTHSTAR</strong><small>{site.name}</small></span>
          </TemplateLink>
          <div className="northstar-nav-links">
            <TemplateLink href="/listings">Find an expert</TemplateLink>
            <TemplateLink href={`/listings?facet.${key("credential-reviewed")}=true`}>
              Operator reviewed
            </TemplateLink>
            {navigation.filter(({ href }) => href === "/owner/listings").map((item) =>
              <TemplateLink key={item.href} href={item.href} className="northstar-join">
                {item.label}
              </TemplateLink>)}
            {appearanceControl}
          </div>
        </nav>
      </header>;
    },
    home({ site, listings, fields, mediaAssets }) {
      const reviewedExperts = listings.filter(reviewed);
      const lead = reviewedExperts[0] ?? listings[0];
      const leadPortrait = lead ? portrait(lead, mediaAssets) : undefined;
      const specialties = [...new Set(listings.flatMap((listing) => {
        const selected = values(listing).specialties;
        return Array.isArray(selected) ? selected.filter((entry): entry is string =>
          typeof entry === "string") : [];
      }))].slice(0, 4);
      return <main className="northstar-home" data-template-product="northstar-experts">
        <section className="northstar-hero">
          <div className="northstar-hero-copy">
            <p className="northstar-kicker">Independent expertise, mapped clearly</p>
            <h1>The right expertise, <em>clearly found.</em></h1>
            <p>{site.description}</p>
            <form action="/listings" method="get" className="northstar-search">
              <label htmlFor="northstar-query">Search by expertise, sector, or name</label>
              <div><input id="northstar-query" name="q" aria-label="Search experts" />
                <button type="submit">Search experts</button></div>
            </form>
            <dl className="northstar-proof">
              <div><dt>Public experts</dt><dd>{listings.length}</dd></div>
              <div><dt>Operator reviewed</dt><dd>{reviewedExperts.length}</dd></div>
              <div><dt>Specialties</dt><dd>{specialties.length}+</dd></div>
            </dl>
          </div>
          {lead && <article className="northstar-lead">
            <TemplateLink href={`/listings/${lead.slug}`}>
              <div className="northstar-photo">{leadPortrait &&
                <TemplateContentImage asset={leadPortrait} />}
                {reviewed(lead) && <span>Reviewed by directory operator</span>}</div>
              <p>{firstChoice(values(lead).specialties)} · {location(values(lead).location)}</p>
              <h2>{lead.name}</h2><strong>{lead.summary}</strong>
              <div><span>{money(values(lead).rate)}</span>
                <span>{label(values(lead).availability)}</span></div>
            </TemplateLink>
          </article>}
        </section>

        <section className="northstar-disciplines" aria-labelledby="northstar-disciplines-heading">
          <div className="northstar-section-heading"><p className="northstar-kicker">Start with the work</p>
            <h2 id="northstar-disciplines-heading">Navigate by specialty.</h2></div>
          <div className="northstar-discipline-grid">{specialties.map((specialty, index) => {
            const matching = listings.filter((listing) => {
              const selected = values(listing).specialties;
              return Array.isArray(selected) && selected.includes(specialty);
            }).length;
            return <TemplateLink key={specialty}
              href={`/listings?facet.${key("specialties")}=${specialty}`}>
              <span>0{index + 1}</span><strong>{label(specialty)}</strong>
              <small>{matching} {matching === 1 ? "expert" : "experts"}</small>
            </TemplateLink>;
          })}</div>
        </section>

        <section className="northstar-roster" aria-labelledby="northstar-roster-heading">
          <div className="northstar-section-heading"><p className="northstar-kicker">Available expertise</p>
            <h2 id="northstar-roster-heading">People, context, and current intent.</h2></div>
          <div className="northstar-card-grid">{listings.slice(0, 6).map((listing) => {
            const image = portrait(listing, mediaAssets);
            return <article key={listing.slug} className="northstar-card">
              <TemplateLink href={`/listings/${listing.slug}`}>
                <div className="northstar-card-image">{image && <TemplateContentImage asset={image} />}
                  {reviewed(listing) && <span>Operator reviewed</span>}</div>
                <p>{firstChoice(values(listing).specialties)}</p><h3>{listing.name}</h3>
                <strong>{listing.summary}</strong>
              </TemplateLink>
              <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets}
                placements={["badge"]} />
            </article>;
          })}</div>
          <TemplateLink href="/listings" className="northstar-all">Browse every expert →</TemplateLink>
        </section>
      </main>;
    },
    card({ listing, fields, mediaAssets, highlighted }) {
      const image = portrait(listing, mediaAssets);
      return <article className="northstar-card">
        <TemplateLink href={`/listings/${listing.slug}`}>
          <div className="northstar-card-image">{image && <TemplateContentImage asset={image} />}
            {reviewed(listing) && <span>Operator reviewed</span>}</div>
          <p>{firstChoice(values(listing).specialties)} · {location(values(listing).location)}</p>
          <h3>{listing.name}</h3><strong>{listing.summary}</strong>
          <div className="northstar-card-facts"><span>{money(values(listing).rate)}</span>
            <span>{label(values(listing).availability)}</span></div>
        </TemplateLink>
        <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets}
          placements={["badge"]} />
        {highlighted && <small className="northstar-featured">Featured placement</small>}
      </article>;
    },
    directory(value) {
      const Card = value.slots?.card ?? TemplateListingCard;
      const Featured = value.slots?.featured;
      return <main className="northstar-directory" data-template-product="northstar-experts">
        <header className="northstar-directory-heading">
          <p className="northstar-kicker">The expertise index</p><h1>Find the right perspective.</h1>
          <p>{value.description}</p>
        </header>
        <div className="northstar-directory-layout">
          <aside><div className="northstar-filter-title">Refine the field</div>{value.facets}</aside>
          <section className="northstar-results" aria-label="Directory results">
            <div className="northstar-results-heading"><h2>{value.total} public {value.total === 1 ? "expert" : "experts"}</h2>
              <span>Qualifications and availability are profile facts.</span></div>
            {Featured
              ? <Featured listings={value.featured} fields={value.fields}
                mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} Card={Card} />
              : value.featured.length > 0 && <section className="northstar-featured-list"
                aria-label="Featured experts">
                <p>Featured placements matching these filters</p>
                <div className="northstar-card-grid">{value.featured.map((listing) =>
                  <div key={listing.slug}><Card listing={listing} fields={value.fields}
                    mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} highlighted /></div>)}</div>
              </section>}
            {value.listings.length === 0
              ? <section className="northstar-empty" aria-live="polite"><strong>No exact match yet.</strong>
                <span>Clear a filter to widen the current search.</span>
                <TemplateLink href="/listings">Browse every expert</TemplateLink></section>
              : <div className="northstar-card-grid">{value.listings.map((listing) =>
                <div key={listing.slug} data-template-result={listing.slug}>
                  <Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets}
                    iconLibrary={value.iconLibrary} />
                </div>)}</div>}
            <TemplatePagination value={value.pagination} />
          </section>
        </div>
      </main>;
    },
    listing(detail) {
      const image = detail.image ?? portrait(detail.listing, detail.mediaAssets);
      const expert = values(detail.listing);
      return <main className="northstar-detail" data-template-product="northstar-experts">
        <TemplateLink href="/listings" className="northstar-back">← All experts</TemplateLink>
        <header>
          <div><p className="northstar-kicker">{firstChoice(expert.specialties)} · {location(expert.location)}</p>
            <h1>{detail.listing.name}</h1><p>{detail.listing.summary}</p>
            <div className="northstar-detail-status"><span>{label(expert.availability)}</span>
              <span>{money(expert.rate)}</span>
              {reviewed(detail.listing) && <span>Operator reviewed {String(expert.reviewedAt)}</span>}</div>
          </div>
          {image && <TemplateContentImage asset={image} />}
        </header>
        <div className="northstar-detail-grid">
          <article><p className="northstar-kicker">Working perspective</p>
            <TemplateMarkdown source={detail.listing.description} />
            <div className="northstar-qualifications"><p className="northstar-kicker">Qualifications</p>
              <TemplateProfileValues fields={detail.fields.filter(({ key: fieldKey }) =>
                fieldKey.endsWith(".credentials") || fieldKey.endsWith(".credential-reviewed") ||
                fieldKey.endsWith(".credential-reviewed-at"))} listing={detail.listing}
                mediaAssets={detail.mediaAssets} /></div>
            <div className="northstar-actions">
              <a href={contactUrl(detail.listing)} target="_blank" rel="noopener noreferrer">
                Start an inquiry ↗
              </a>
              <a href={detail.markdownHref} type="text/markdown" rel="alternate">Markdown</a>
            </div>
            <small>Inquiry links open the expert’s public contact page. NORTHSTAR does not promise booking or response.</small>
          </article>
          <aside><p className="northstar-kicker">At a glance</p>
            <TemplateProfileValues fields={detail.fields.filter(({ key: fieldKey }) =>
              !fieldKey.endsWith(".portraits") && !fieldKey.endsWith(".credentials") &&
              !fieldKey.endsWith(".credential-reviewed") && !fieldKey.endsWith(".credential-reviewed-at") &&
              !fieldKey.endsWith(".contact-url"))} listing={detail.listing}
              mediaAssets={detail.mediaAssets} /></aside>
        </div>
      </main>;
    },
    pagination({ value }) {
      return <TemplatePagination value={value} />;
    },
    footer({ site, navigation }) {
      return <footer className="northstar-footer"><div className="northstar-footer-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/addons/northstar-experts/northstar-mark.svg" alt="" width="38" height="38" />
        <div><strong>NORTHSTAR</strong><p>The right expertise, clearly found.</p><span>{site.name}</span></div>
      </div><nav aria-label="Footer navigation">{navigation.map((item) =>
        <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}</nav></footer>;
    },
  },
} satisfies PublicTemplateDefinition;

export default northstarTemplate;
