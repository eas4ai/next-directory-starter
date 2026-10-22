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
  destination: listing.profileValues["elsewhere-travel.experiences.destination"],
  destinationRegion: listing.profileValues["elsewhere-travel.experiences.destination-region"],
  meeting: listing.profileValues["elsewhere-travel.experiences.meeting-location"],
  type: listing.profileValues["elsewhere-travel.experiences.experience-type"],
  seasons: listing.profileValues["elsewhere-travel.experiences.seasons"],
  activities: listing.profileValues["elsewhere-travel.experiences.activities"],
  duration: listing.profileValues["elsewhere-travel.experiences.duration"],
  price: listing.profileValues["elsewhere-travel.experiences.price"],
  groupSize: listing.profileValues["elsewhere-travel.experiences.group-size"],
  difficulty: listing.profileValues["elsewhere-travel.experiences.difficulty"],
  accessibility: listing.profileValues["elsewhere-travel.experiences.accessibility"],
  inclusions: listing.profileValues["elsewhere-travel.experiences.inclusions"],
  booking: listing.profileValues["elsewhere-travel.experiences.booking-url"],
  itinerary: listing.profileValues["elsewhere-travel.experiences.itinerary"],
  media: listing.profileValues["elsewhere-travel.experiences.travel-media"],
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
const duration = (value: unknown) => typeof value === "number"
  ? value >= 86400 ? `${Math.round(value / 86400)} days` : `${Math.round(value / 3600)} hours`
  : "Duration listed";
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

const template = {
  id: "elsewhere-travel",
  name: "Elsewhere Travel",
  supportedProfiles: [{ id: "elsewhere-travel.experiences", range: "^1.0.0" }],
  renderers: {
    header({ site, navigation, appearanceControl }) {
      return <header className="elsewhere-header"><nav className="elsewhere-nav" aria-label="Main navigation">
        <TemplateLink href="/" className="elsewhere-brand" aria-label={`${site.name} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/addons/elsewhere-travel/elsewhere-mark.svg" alt="" width="44" height="44" />
          <strong>Elsewhere</strong>
        </TemplateLink>
        <div><TemplateLink href="/listings">Experiences</TemplateLink>{navigation
          .filter(({ href }) => href === "/owner/listings")
          .map((item) => <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}
          {appearanceControl}</div>
      </nav></header>;
    },
    home({ site, listings, fields, mediaAssets }) {
      const lead = listings[0];
      const leadImage = lead ? photo(lead, mediaAssets) : undefined;
      const destinations = listings.map((listing) => ({
        label: facts(listing).destination,
        value: facts(listing).destinationRegion,
      })).filter((destination): destination is { label: string; value: string } =>
        typeof destination.label === "string" && typeof destination.value === "string")
        .filter((destination, index, values) => values.findIndex(({ value }) => value === destination.value) === index)
        .slice(0, 6);
      return <main className="elsewhere-home" data-template-product="elsewhere-travel">
        <section className="elsewhere-hero">
          {lead && <TemplateLink className="elsewhere-hero-image" href={`/listings/${lead.slug}`}>
            {leadImage && <TemplateContentImage asset={leadImage} />}
            <span><b>{first(facts(lead).seasons)}</b><b>{duration(facts(lead).duration)}</b></span>
          </TemplateLink>}
          <div className="elsewhere-hero-copy"><p>Curated ways into a place</p><h1>Go where the<br /><em>day takes you.</em></h1>
            <span>{site.description}</span><form action="/listings" method="get">
              <label htmlFor="elsewhere-search">Search by place or experience</label>
              <div><input id="elsewhere-search" name="q" aria-label="Search travel experiences" />
                <button type="submit">Explore</button></div>
            </form>
          </div>
        </section>
        <section className="elsewhere-destinations"><header><p>Start with a place</p><h2>A horizon for every kind of day.</h2></header>
          <nav aria-label="Featured destinations">{destinations.map((destination, index) =>
            <TemplateLink key={destination.value} href={`/listings?facet.elsewhere-travel.experiences.destination-region=${destination.value}`}>
              <span>0{index + 1}</span><strong>{destination.label}</strong>
            </TemplateLink>)}</nav>
        </section>
        <section className="elsewhere-picks"><header><p>Field notes</p><h2>Small groups. Wide-open stories.</h2></header>
          <div className="elsewhere-grid">{listings.slice(0, 6).map((listing) => {
            const image = photo(listing, mediaAssets);
            return <article className="elsewhere-card" key={listing.slug}><TemplateLink href={`/listings/${listing.slug}`}>
              {image && <TemplateContentImage asset={image} />}<p>{String(facts(listing).destination)}</p><h3>{listing.name}</h3>
              <span>{listing.summary}</span><div><b>{first(facts(listing).activities)}</b><b>{duration(facts(listing).duration)}</b><b>{money(facts(listing).price)}</b></div>
            </TemplateLink><TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets} placements={["badge"]} /></article>;
          })}</div>
        </section>
      </main>;
    },
    card({ listing, fields, mediaAssets, highlighted }) {
      const image = photo(listing, mediaAssets);
      return <article className="elsewhere-card"><TemplateLink href={`/listings/${listing.slug}`}>
        {image && <TemplateContentImage asset={image} />}<p>{String(facts(listing).destination)}</p><h3>{listing.name}</h3>
        <span>{listing.summary}</span><div><b>{first(facts(listing).activities)}</b><b>{duration(facts(listing).duration)}</b><b>{money(facts(listing).price)}</b></div>
      </TemplateLink><TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets} placements={["badge"]} />
        {highlighted && <small>Featured journey</small>}</article>;
    },
    directory(value) {
      const Card = value.slots?.card ?? TemplateListingCard;
      const Featured = value.slots?.featured;
      return <main className="elsewhere-directory" data-template-product="elsewhere-travel">
        <header><p>Experience atlas / {value.total} public journeys</p><h1>Find the day<br />you will remember.</h1><span>{value.description}</span></header>
        <div className="elsewhere-directory-layout"><aside><strong>Shape the trip</strong>{value.facets}</aside>
          <section className="elsewhere-results" aria-label="Directory results">
            {Featured ? <Featured listings={value.featured} fields={value.fields} mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} Card={Card} />
              : value.featured.length > 0 && <div className="elsewhere-grid">{value.featured.map((listing) => <div key={listing.slug}>
                <Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} highlighted />
              </div>)}</div>}
            {value.listings.length ? <div className="elsewhere-grid">{value.listings.map((listing) =>
              <div key={listing.slug} data-template-result={listing.slug}><Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} /></div>)}</div>
              : <section className="elsewhere-empty" aria-live="polite"><strong>No experience matches every selection.</strong><TemplateLink href="/listings">Clear the route</TemplateLink></section>}
            <TemplatePagination value={value.pagination} />
          </section>
        </div>
      </main>;
    },
    listing(detail) {
      const image = detail.image ?? photo(detail.listing, detail.mediaAssets);
      const booking = facts(detail.listing).booking;
      return <main className="elsewhere-detail" data-template-product="elsewhere-travel">
        <TemplateLink href="/listings">← All experiences</TemplateLink>
        <header><div><p>{String(facts(detail.listing).destination)}</p><h1>{detail.listing.name}</h1><strong>{detail.listing.summary}</strong>
          <div><span>{first(facts(detail.listing).seasons)}</span><span>{duration(facts(detail.listing).duration)}</span><span>{money(facts(detail.listing).price)}</span><span>Up to {String(facts(detail.listing).groupSize)} people</span></div>
        </div>{image && <TemplateContentImage asset={image} />}</header>
        <div className="elsewhere-detail-grid"><article><p>The experience</p><TemplateMarkdown source={detail.listing.description} />
          <section><p>Published itinerary</p><TemplateProfileValues fields={detail.fields.filter(({ key }) => key.endsWith(".itinerary"))} listing={detail.listing} mediaAssets={detail.mediaAssets} /></section>
          <div className="elsewhere-actions">{typeof booking === "string" && <a href={booking} target="_blank" rel="noopener noreferrer">View trip and booking details ↗</a>}
            <a href={detail.markdownHref} type="text/markdown" rel="alternate">Markdown</a></div>
          <small>Provider links do not promise live availability, a reservation, transportation, payment, or fulfillment.</small>
        </article><aside><p>Trip essentials</p><TemplateProfileValues fields={detail.fields.filter(({ key }) => !key.endsWith(".travel-media") && !key.endsWith(".itinerary") && !key.endsWith(".booking-url"))} listing={detail.listing} mediaAssets={detail.mediaAssets} /></aside></div>
      </main>;
    },
    pagination({ value }) { return <TemplatePagination value={value} />; },
    footer({ site, navigation }) {
      return <footer className="elsewhere-footer"><div><strong>Elsewhere</strong><p>Go where the day takes you.</p><span>{site.name}</span></div>
        <nav aria-label="Footer navigation">{navigation.map((item) => <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}</nav></footer>;
    },
  },
} satisfies PublicTemplateDefinition;

export default template;
