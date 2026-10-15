import type {
  PublicTemplateDefinition, PublicTemplateHomeProps, PublicTemplateListing,
} from "@/lib/public-template-sdk";
import {
  TemplateContentImage, TemplateLink, TemplateListingCard, TemplateMarkdown,
  TemplatePagination, TemplateProfileValues,
} from "@/components/public-template-primitives";

const facts = (listing: PublicTemplateListing) => ({
  services: listing.profileValues["form-agencies.studios.services"],
  industries: listing.profileValues["form-agencies.studios.industries"],
  headquarters: listing.profileValues["form-agencies.studios.headquarters"],
  teamSize: listing.profileValues["form-agencies.studios.team-size"],
  budget: listing.profileValues["form-agencies.studios.minimum-budget"],
  availability: listing.profileValues["form-agencies.studios.availability"],
  leadTime: listing.profileValues["form-agencies.studios.lead-time"],
  contactUrl: listing.profileValues["form-agencies.studios.contact-url"],
  portfolio: listing.profileValues["form-agencies.studios.portfolio-media"],
});
const words = (value: unknown) => typeof value === "string"
  ? value.split("-").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ") : "";
const first = (value: unknown) => Array.isArray(value) ? words(value[0]) : words(value);
const city = (value: unknown) => value && typeof value === "object" && "locality" in value &&
  typeof value.locality === "string" ? value.locality : "Distributed";
const currency = (value: unknown) => {
  if (!value || typeof value !== "object" || !("amountMinor" in value) || !("currency" in value) ||
      typeof value.amountMinor !== "number" || typeof value.currency !== "string") return "Budget on request";
  return `From ${new Intl.NumberFormat("en", { style: "currency", currency: value.currency,
    maximumFractionDigits: 0 }).format(value.amountMinor / 100)}`;
};
const mediaId = (listing: PublicTemplateListing) => {
  const media = facts(listing).portfolio;
  if (!Array.isArray(media) || media.length === 0) return undefined;
  const item = media[0];
  return item && typeof item === "object" && "value" in item && typeof item.value === "string"
    ? item.value : undefined;
};
const artwork = (listing: PublicTemplateListing,
  assets: PublicTemplateHomeProps["mediaAssets"]) => {
  const id = mediaId(listing);
  return id ? assets.get(id) : undefined;
};
const contact = (listing: PublicTemplateListing) => typeof facts(listing).contactUrl === "string"
  ? facts(listing).contactUrl as string : listing.url;

const formTemplate = {
  id: "form-agencies",
  name: "FORM Agencies Directory",
  supportedProfiles: [{ id: "form-agencies.studios", range: "^1.0.0" }],
  renderers: {
    header({ site, navigation, appearanceControl }) {
      return <header className="form-header"><nav className="form-nav" aria-label="Main navigation">
        <TemplateLink href="/" className="form-brand" aria-label={`${site.name} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/addons/form-agencies/form-mark.svg" alt="" width="45" height="45" />
          <strong>FORM</strong><small>{site.name}</small>
        </TemplateLink>
        <div>{navigation.filter(({ href }) => href === "/listings" || href === "/owner/listings")
          .map((item) => <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}
          {appearanceControl}</div>
      </nav></header>;
    },
    home({ site, listings, fields, mediaAssets }) {
      const lead = listings[0];
      const leadArt = lead ? artwork(lead, mediaAssets) : undefined;
      return <main className="form-home" data-template-product="form-agencies">
        <section className="form-hero"><p>Independent studios / current work / clear terms</p>
          <h1>Big work deserves a <em>bigger stage.</em></h1>
          <div><p>{site.description}</p><form action="/listings" method="get">
            <label htmlFor="form-search">Search studios, services, or industries</label>
            <div><input id="form-search" name="q" aria-label="Search studios" />
              <button type="submit">Find a studio →</button></div>
          </form></div>
        </section>
        {lead && <section className="form-lead">
          <TemplateLink href={`/listings/${lead.slug}`} className="form-lead-art">
            {leadArt && <TemplateContentImage asset={leadArt} />}
            <span>01 / Selected work</span></TemplateLink>
          <div><p>{first(facts(lead).services)} / {city(facts(lead).headquarters)}</p>
            <h2>{lead.name}</h2><strong>{lead.summary}</strong>
            <dl><div><dt>Team</dt><dd>{words(facts(lead).teamSize)}</dd></div>
              <div><dt>Engagement</dt><dd>{currency(facts(lead).budget)}</dd></div></dl>
            <TemplateLink href={`/listings/${lead.slug}`}>View studio and attributed work →</TemplateLink>
          </div>
        </section>}
        <section className="form-index" aria-labelledby="form-index-title">
          <header><span>Portfolio index</span><h2 id="form-index-title">Work first. Context close behind.</h2>
            <TemplateLink href="/listings">All studios ↗</TemplateLink></header>
          <div className="form-work-grid">{listings.slice(1, 9).map((listing, index) => {
            const image = artwork(listing, mediaAssets);
            return <article key={listing.slug} className={`form-work form-work-${index + 1}`}>
              <TemplateLink href={`/listings/${listing.slug}`}>
                <div>{image && <TemplateContentImage asset={image} />}<span>0{index + 2}</span></div>
                <p>{first(facts(listing).services)} / {first(facts(listing).industries)}</p>
                <h3>{listing.name}</h3><strong>{listing.summary}</strong>
              </TemplateLink>
              <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets}
                placements={["badge"]} />
            </article>;
          })}</div>
        </section>
      </main>;
    },
    card({ listing, fields, mediaAssets, highlighted }) {
      const image = artwork(listing, mediaAssets);
      return <article className="form-card"><TemplateLink href={`/listings/${listing.slug}`}>
        <div className="form-card-art">{image && <TemplateContentImage asset={image} />}</div>
        <p>{first(facts(listing).services)} / {city(facts(listing).headquarters)}</p>
        <h3>{listing.name}</h3><strong>{listing.summary}</strong>
        <dl><div><dt>Minimum</dt><dd>{currency(facts(listing).budget)}</dd></div>
          <div><dt>Status</dt><dd>{words(facts(listing).availability)}</dd></div></dl>
      </TemplateLink><TemplateProfileValues fields={fields} listing={listing}
        mediaAssets={mediaAssets} placements={["badge"]} />
        {highlighted && <small>Featured placement</small>}</article>;
    },
    directory(value) {
      const Card = value.slots?.card ?? TemplateListingCard;
      const Featured = value.slots?.featured;
      return <main className="form-directory" data-template-product="form-agencies">
        <header><p>Studio index / {value.total} public profiles</p><h1>Find the shape of the work.</h1>
          <span>{value.description}</span></header>
        <div className="form-directory-layout"><aside><strong>Filter the index</strong>{value.facets}</aside>
          <section className="form-results" aria-label="Directory results">
            {Featured ? <Featured listings={value.featured} fields={value.fields}
              mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} Card={Card} />
              : value.featured.length > 0 && <section className="form-featured" aria-label="Featured studios">
                <p>Featured studios / paid placements matching these filters</p>
                <div className="form-card-grid">{value.featured.map((listing) => <div key={listing.slug}>
                  <Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets}
                    iconLibrary={value.iconLibrary} highlighted /></div>)}</div></section>}
            {value.listings.length === 0 ? <section className="form-empty" aria-live="polite">
              <strong>No studio matches every current filter.</strong><TemplateLink href="/listings">Reset the index</TemplateLink>
            </section> : <div className="form-card-grid">{value.listings.map((listing) =>
              <div key={listing.slug} data-template-result={listing.slug}><Card listing={listing}
                fields={value.fields} mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} /></div>)}</div>}
            <TemplatePagination value={value.pagination} />
          </section></div>
      </main>;
    },
    listing(detail) {
      const image = detail.image ?? artwork(detail.listing, detail.mediaAssets);
      return <main className="form-detail" data-template-product="form-agencies">
        <TemplateLink href="/listings" className="form-back">← Studio index</TemplateLink>
        <header><div><p>{first(facts(detail.listing).services)} / {city(facts(detail.listing).headquarters)}</p>
          <h1>{detail.listing.name}</h1><strong>{detail.listing.summary}</strong></div>
          <dl><div><dt>Minimum budget</dt><dd>{currency(facts(detail.listing).budget)}</dd></div>
            <div><dt>Availability</dt><dd>{words(facts(detail.listing).availability)}</dd></div></dl></header>
        {image && <div className="form-detail-art"><TemplateContentImage asset={image} /></div>}
        <div className="form-detail-grid"><article><p>Studio position</p>
          <TemplateMarkdown source={detail.listing.description} />
          <section className="form-cases"><p>Attributed case studies</p>
            <TemplateProfileValues fields={detail.fields.filter(({ key }) => key.endsWith(".case-studies"))}
              listing={detail.listing} mediaAssets={detail.mediaAssets} /></section>
          <div className="form-actions"><a href={contact(detail.listing)} target="_blank"
            rel="noopener noreferrer">Open studio inquiry ↗</a>
            <a href={detail.markdownHref} type="text/markdown" rel="alternate">Markdown</a></div>
          <small>Case-study claims are attributed to the listed studio. Inquiry links do not promise acceptance or response.</small>
        </article><aside><p>Studio facts</p><TemplateProfileValues fields={detail.fields.filter(({ key }) =>
          !key.endsWith(".portfolio-media") && !key.endsWith(".case-studies") && !key.endsWith(".contact-url"))}
          listing={detail.listing} mediaAssets={detail.mediaAssets} /></aside></div>
      </main>;
    },
    pagination({ value }) { return <TemplatePagination value={value} />; },
    footer({ site, navigation }) {
      return <footer className="form-footer"><div><strong>FORM</strong>
        <p>Big work deserves a bigger stage.</p><span>{site.name}</span></div>
        <nav aria-label="Footer navigation">{navigation.map((item) =>
          <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}</nav></footer>;
    },
  },
} satisfies PublicTemplateDefinition;

export default formTemplate;
