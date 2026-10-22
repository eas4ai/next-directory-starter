import type {
  PublicTemplateDefinition,
  PublicTemplateHomeProps,
  PublicTemplateListing,
} from "@/lib/public-template-sdk";
import {
  TemplateContentImage,
  TemplateLink,
  TemplateListingCard,
  TemplateMarkdown,
  TemplatePagination,
  TemplateProfileValues,
} from "@/components/public-template-primitives";

const facts = (listing: PublicTemplateListing) => ({
  services: listing.profileValues["homekind-services.providers.services"],
  areas: listing.profileValues["homekind-services.providers.service-area"],
  location: listing.profileValues["homekind-services.providers.base-location"],
  pricing: listing.profileValues["homekind-services.providers.pricing-model"],
  minimum: listing.profileValues["homekind-services.providers.minimum-price"],
  response: listing.profileValues["homekind-services.providers.response-time"],
  emergency: listing.profileValues["homekind-services.providers.emergency-service"],
  availability: listing.profileValues["homekind-services.providers.availability"],
  years: listing.profileValues["homekind-services.providers.years-in-business"],
  licenses: listing.profileValues["homekind-services.providers.licenses"],
  insured: listing.profileValues["homekind-services.providers.insured"],
  reviewed: listing.profileValues["homekind-services.providers.provider-reviewed"],
  reviewedAt: listing.profileValues["homekind-services.providers.provider-reviewed-at"],
  rating: listing.profileValues["homekind-services.providers.aggregate-rating"],
  reviewCount: listing.profileValues["homekind-services.providers.review-count"],
  reviewSource: listing.profileValues["homekind-services.providers.review-source-url"],
  quote: listing.profileValues["homekind-services.providers.quote-url"],
  accessibility: listing.profileValues["homekind-services.providers.accessibility"],
  media: listing.profileValues["homekind-services.providers.work-media"],
});

const words = (value: unknown) => typeof value === "string"
  ? value.split("-").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ")
  : "";
const first = (value: unknown) => Array.isArray(value) ? words(value[0]) : words(value);
const money = (value: unknown) => value && typeof value === "object"
  && "amountMinor" in value && "currency" in value
  && typeof value.amountMinor === "number" && typeof value.currency === "string"
  ? new Intl.NumberFormat("en", { style: "currency", currency: value.currency, maximumFractionDigits: 0 })
    .format(value.amountMinor / 100)
  : "Price listed";
const responseTime = (value: unknown) => typeof value === "number"
  ? value >= 86400 ? `${Math.round(value / 86400)} day response` : `${Math.round(value / 3600)} hour response`
  : "Response listed";
const mediaId = (listing: PublicTemplateListing) => {
  const media = facts(listing).media;
  if (!Array.isArray(media) || !media.length) return;
  const item = media[0];
  return item && typeof item === "object" && "value" in item && typeof item.value === "string"
    ? item.value : undefined;
};
const photo = (listing: PublicTemplateListing, assets: PublicTemplateHomeProps["mediaAssets"]) => {
  const id = mediaId(listing);
  return id ? assets.get(id) : undefined;
};
const Review = ({ listing }: { listing: PublicTemplateListing }) => {
  const value = facts(listing);
  if (typeof value.rating !== "string") return null;
  return <span className="homekind-review"><b>{value.rating}</b> / 5 · {String(value.reviewCount)} attributed reviews
    {value.reviewed === true && <em>Evidence reviewed by Homekind</em>}</span>;
};

const template = {
  id: "homekind-services",
  name: "Homekind Services",
  supportedProfiles: [{ id: "homekind-services.providers", range: "^1.0.0" }],
  renderers: {
    header({ site, navigation, appearanceControl }) {
      return <header className="homekind-header"><nav className="homekind-nav" aria-label="Main navigation">
        <TemplateLink href="/" className="homekind-brand" aria-label={`${site.name} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/addons/homekind-services/homekind-mark.svg" alt="" width="42" height="42" />
          <strong>homekind</strong>
        </TemplateLink>
        <div><TemplateLink href="/listings">Find help</TemplateLink>{navigation
          .filter(({ href }) => href === "/owner/listings")
          .map((item) => <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}
          {appearanceControl}</div>
      </nav></header>;
    },
    home({ site, listings, fields, mediaAssets }) {
      const lead = listings[0];
      const leadImage = lead ? photo(lead, mediaAssets) : undefined;
      const services = [...new Set(listings.flatMap((listing) => {
        const value = facts(listing).services;
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      }))].slice(0, 8);
      return <main className="homekind-home" data-template-product="homekind-services">
        <section className="homekind-hero"><div><p>Trusted details for the work at home</p><h1>Good help for the<br /><em>place you love.</em></h1>
          <span>{site.description}</span><form action="/listings" method="get"><label htmlFor="homekind-search">What does your home need?</label>
            <div><input id="homekind-search" name="q" aria-label="Search home service providers" /><button type="submit">Find a provider</button></div>
          </form><nav aria-label="Popular services">{services.map((service) => <TemplateLink key={service} href={`/listings?facet.homekind-services.providers.services=${service}`}>{words(service)}</TemplateLink>)}</nav>
        </div>{lead && <TemplateLink className="homekind-lead" href={`/listings/${lead.slug}`}>
          {leadImage && <TemplateContentImage asset={leadImage} />}<span>Featured provider</span><h2>{lead.name}</h2><p>{lead.summary}</p><Review listing={lead} />
        </TemplateLink>}</section>
        <section className="homekind-assurance"><div><strong>01</strong><h2>Compare clear service facts.</h2><p>See area, pricing model, minimum price, typical response, insurance statement, and public credential evidence.</p></div>
          <div><strong>02</strong><h2>Trace review information.</h2><p>Ratings and counts name their stored source, and Homekind states when an operator reviewed the evidence.</p></div>
          <div><strong>03</strong><h2>Contact the provider directly.</h2><p>Quote links open provider information with no promise of response, hiring, payment, or completed work.</p></div></section>
        <section className="homekind-picks"><header><p>Ready around town</p><h2>People who know the work.</h2></header><div className="homekind-grid">{listings.slice(0, 6).map((listing) => {
          const image = photo(listing, mediaAssets);
          return <article className="homekind-card" key={listing.slug}><TemplateLink href={`/listings/${listing.slug}`}>
            {image && <TemplateContentImage asset={image} />}<p>{first(facts(listing).services)} · {first(facts(listing).areas)}</p><h3>{listing.name}</h3><span>{listing.summary}</span>
            <div><b>From {money(facts(listing).minimum)}</b><b>{responseTime(facts(listing).response)}</b></div><Review listing={listing} />
          </TemplateLink><TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets} placements={["badge"]} /></article>;
        })}</div></section>
      </main>;
    },
    card({ listing, fields, mediaAssets, highlighted }) {
      const image = photo(listing, mediaAssets);
      return <article className="homekind-card"><TemplateLink href={`/listings/${listing.slug}`}>
        {image && <TemplateContentImage asset={image} />}<p>{first(facts(listing).services)} · {first(facts(listing).areas)}</p><h3>{listing.name}</h3><span>{listing.summary}</span>
        <div><b>From {money(facts(listing).minimum)}</b><b>{responseTime(facts(listing).response)}</b></div><Review listing={listing} />
      </TemplateLink><TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets} placements={["badge"]} />
        {highlighted && <small>Featured provider</small>}</article>;
    },
    directory(value) {
      const Card = value.slots?.card ?? TemplateListingCard;
      const Featured = value.slots?.featured;
      return <main className="homekind-directory" data-template-product="homekind-services">
        <header><p>Local provider index / {value.total} public businesses</p><h1>Find the right help<br />for home.</h1><span>{value.description}</span></header>
        <div className="homekind-directory-layout"><aside><strong>Narrow the list</strong>{value.facets}</aside><section className="homekind-results" aria-label="Directory results">
          {Featured ? <Featured listings={value.featured} fields={value.fields} mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} Card={Card} />
            : value.featured.length > 0 && <div className="homekind-grid">{value.featured.map((listing) => <div key={listing.slug}>
              <Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} highlighted />
            </div>)}</div>}
          {value.listings.length ? <div className="homekind-grid">{value.listings.map((listing) => <div key={listing.slug} data-template-result={listing.slug}>
            <Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} />
          </div>)}</div> : <section className="homekind-empty" aria-live="polite"><strong>No provider matches every selection.</strong><TemplateLink href="/listings">See all providers</TemplateLink></section>}
          <TemplatePagination value={value.pagination} />
        </section></div>
      </main>;
    },
    listing(detail) {
      const image = detail.image ?? photo(detail.listing, detail.mediaAssets);
      const value = facts(detail.listing);
      return <main className="homekind-detail" data-template-product="homekind-services">
        <TemplateLink href="/listings">← All providers</TemplateLink><header><div><p>{first(value.services)} · {first(value.areas)}</p><h1>{detail.listing.name}</h1><strong>{detail.listing.summary}</strong>
          <div><span>From {money(value.minimum)}</span><span>{responseTime(value.response)}</span><span>{words(value.availability)}</span>{value.emergency === true && <span>Emergency service stated</span>}</div><Review listing={detail.listing} />
        </div>{image && <TemplateContentImage asset={image} />}</header>
        <div className="homekind-detail-grid"><article><p>About the provider</p><TemplateMarkdown source={detail.listing.description} />
          <section className="homekind-evidence"><p>Homekind review trail</p><strong>{value.reviewed === true ? "Provider evidence reviewed" : "Provider evidence not yet reviewed"}</strong>
            <span>Review date: {String(value.reviewedAt)}</span><span>Rating: {String(value.rating)} from {String(value.reviewCount)} reviews</span>
            {typeof value.reviewSource === "string" && <a href={value.reviewSource} target="_blank" rel="noopener noreferrer">Attributed public review source ↗</a>}
          </section>
          <div className="homekind-actions">{typeof value.quote === "string" && <a href={value.quote} target="_blank" rel="noopener noreferrer">View quote information ↗</a>}
            <a href={detail.markdownHref} type="text/markdown" rel="alternate">Markdown</a></div>
          <small>Provider links do not promise a response, quote delivery, matching, hiring, payment, or job completion.</small>
        </article><aside><p>Service facts</p><TemplateProfileValues fields={detail.fields.filter(({ key }) => !key.endsWith(".work-media") && !key.endsWith(".quote-url") && !key.endsWith(".provider-reviewed") && !key.endsWith(".provider-reviewed-at") && !key.endsWith(".aggregate-rating") && !key.endsWith(".review-count") && !key.endsWith(".review-source-url"))} listing={detail.listing} mediaAssets={detail.mediaAssets} /></aside></div>
      </main>;
    },
    pagination({ value }) { return <TemplatePagination value={value} />; },
    footer({ site, navigation }) {
      return <footer className="homekind-footer"><div><strong>homekind</strong><p>Good help for the place you love.</p><span>{site.name}</span></div>
        <nav aria-label="Footer navigation">{navigation.map((item) => <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}</nav></footer>;
    },
  },
} satisfies PublicTemplateDefinition;

export default template;
