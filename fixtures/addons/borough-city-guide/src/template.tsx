import type {
  PublicTemplateDefinition, PublicTemplateHomeProps, PublicTemplateListing,
} from "@/lib/public-template-sdk";
import {
  TemplateContentImage, TemplateLink, TemplateListingCard, TemplateMarkdown,
  TemplatePagination, TemplateProfileValues,
} from "@/components/public-template-primitives";

const facts = (listing: PublicTemplateListing) => ({
  neighborhood: listing.profileValues["borough-city-guide.places.neighborhood"],
  placeType: listing.profileValues["borough-city-guide.places.place-type"],
  address: listing.profileValues["borough-city-guide.places.address"],
  location: listing.profileValues["borough-city-guide.places.location"],
  priceLevel: listing.profileValues["borough-city-guide.places.price-level"],
  accessibility: listing.profileValues["borough-city-guide.places.accessibility"],
  bestFor: listing.profileValues["borough-city-guide.places.best-for"],
  visitDuration: listing.profileValues["borough-city-guide.places.visit-duration"],
  curatorNote: listing.profileValues["borough-city-guide.places.curator-note"],
  editorialPick: listing.profileValues["borough-city-guide.places.editorial-pick"],
  trails: listing.profileValues["borough-city-guide.places.trails"],
  photography: listing.profileValues["borough-city-guide.places.photography"],
});
const words = (input: unknown) => typeof input === "string"
  ? input.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") : "";
const mediaId = (listing: PublicTemplateListing) => {
  const photos = facts(listing).photography;
  if (typeof photos === "string") return photos;
  if (!Array.isArray(photos) || !photos.length) return undefined;
  const first = photos[0];
  return first && typeof first === "object" && "value" in first && typeof first.value === "string"
    ? first.value : undefined;
};
const photo = (listing: PublicTemplateListing, assets: PublicTemplateHomeProps["mediaAssets"]) => {
  const id = mediaId(listing);
  return id ? assets.get(id) : undefined;
};
const trails = (listing: PublicTemplateListing) => {
  const selected = facts(listing).trails;
  return Array.isArray(selected) ? selected.filter((entry): entry is string => typeof entry === "string") : [];
};

const boroughTemplate = {
  id: "borough-city-guide",
  name: "BOROUGH Local City Guide",
  renderers: {
    header({ site, navigation, appearanceControl }) {
      return <header className="borough-header">
        <nav className="borough-nav" aria-label="Main navigation">
          <TemplateLink href="/" className="borough-wordmark" aria-label={`${site.name} home`}>
            {/* Installed add-on assets use their stable namespaced public path. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/addons/borough-city-guide/borough-mark.svg" alt="" width="32" height="32" />
            <strong>BOROUGH</strong><span>{site.name}</span>
          </TemplateLink>
          <div className="borough-nav-links">
            <TemplateLink href="/listings">Places</TemplateLink>
            <TemplateLink href="/listings?facet.borough-city-guide.places.editorial-pick=true">
              Editor&apos;s picks
            </TemplateLink>
            {navigation.filter(({ href }) => href === "/owner/listings").map((item) =>
              <TemplateLink key={item.href} href={item.href} className="borough-submit">
                {item.label}
              </TemplateLink>)}
            {appearanceControl}
          </div>
        </nav>
      </header>;
    },
    home({ site, listings, fields, mediaAssets }) {
      const neighborhoods = [...new Set(listings.map((listing) => facts(listing).neighborhood)
        .filter((entry): entry is string => typeof entry === "string"))].slice(0, 4);
      const editorial = listings.filter((listing) => facts(listing).editorialPick === true).slice(0, 4);
      const trailNames = [...new Set(listings.flatMap(trails))].slice(0, 4);
      const lead = editorial[0] ?? listings[0];
      const leadPhoto = lead ? photo(lead, mediaAssets) : undefined;
      return <main className="borough-home">
        <section className="borough-hero">
          <div className="borough-hero-copy">
            <p className="borough-eyebrow">A guide to the streets we share</p>
            <h1>The city,<br /><em>known by locals.</em></h1>
            <p>{site.description}</p>
            <form action="/listings" method="get" className="borough-search">
              <label htmlFor="borough-home-query">What are you looking for?</label>
              <div><input id="borough-home-query" name="q" placeholder="A quiet table, a good book…" />
                <button type="submit">Find a place</button></div>
            </form>
          </div>
          {lead && <TemplateLink href={`/listings/${lead.slug}`} className="borough-lead"
            data-borough-place={lead.slug}>
            {leadPhoto && <TemplateContentImage asset={leadPhoto} />}
            <span>Editor&apos;s note / {words(facts(lead).neighborhood)}</span>
            <strong>{lead.name}</strong><p>{lead.summary}</p>
          </TemplateLink>}
        </section>

        <section className="borough-neighborhoods" aria-labelledby="borough-neighborhood-heading">
          <div className="borough-section-heading"><p>Find your corner</p>
            <h2 id="borough-neighborhood-heading">Explore by neighborhood</h2></div>
          <div className="borough-neighborhood-grid">{neighborhoods.map((neighborhood, index) => {
            const count = listings.filter((listing) => facts(listing).neighborhood === neighborhood).length;
            return <TemplateLink key={neighborhood}
              href={`/listings?facet.borough-city-guide.places.neighborhood=${neighborhood}`}
              data-borough-neighborhood={neighborhood}>
              <span>0{index + 1}</span><strong>{words(neighborhood)}</strong>
              <small>{count} {count === 1 ? "place" : "places"}</small>
            </TemplateLink>;
          })}</div>
        </section>

        <section className="borough-picks" aria-labelledby="borough-picks-heading">
          <div className="borough-section-heading"><p>Worth crossing town for</p>
            <h2 id="borough-picks-heading">From the local notebook</h2></div>
          <div className="borough-pick-grid">{editorial.map((listing) => {
            const image = photo(listing, mediaAssets);
            return <article key={listing.slug} data-borough-place={listing.slug}>
              <TemplateLink href={`/listings/${listing.slug}`}>
                {image && <TemplateContentImage asset={image} />}
                <span>{words(facts(listing).neighborhood)}</span>
                <h3>{listing.name}</h3><p>{listing.summary}</p>
              </TemplateLink>
              <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets}
                placements={["badge"]} />
            </article>;
          })}</div>
        </section>

        <section className="borough-trails" aria-labelledby="borough-trails-heading">
          <div><p className="borough-eyebrow">Walk it like a local</p>
            <h2 id="borough-trails-heading">Curated trails through the city.</h2>
            <p>Small routes for a free afternoon, assembled from current places in the guide.</p></div>
          <nav aria-label="Curated place trails">{trailNames.map((trail, index) =>
            <TemplateLink key={trail}
              href={`/listings?facet.borough-city-guide.places.trails=${trail}`}
              data-borough-trail={trail}>
              <span>Trail 0{index + 1}</span><strong>{words(trail)}</strong><em>Follow the route →</em>
            </TemplateLink>)}</nav>
        </section>
      </main>;
    },
    card({ listing, fields, mediaAssets, highlighted }) {
      const image = photo(listing, mediaAssets);
      return <article className="borough-card">
        <TemplateLink href={`/listings/${listing.slug}`}>
          <div className="borough-card-image">{image && <TemplateContentImage asset={image} />}
            {facts(listing).editorialPick === true && <span>Editor&apos;s pick</span>}</div>
          <div className="borough-card-copy"><p>{words(facts(listing).neighborhood)}</p>
            <h3>{listing.name}</h3><span>{listing.summary}</span></div>
        </TemplateLink>
        <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets}
          placements={["badge", "card"]} />
        {highlighted && <small className="borough-featured">Featured placement</small>}
      </article>;
    },
    directory(value) {
      const Card = value.slots?.card ?? TemplateListingCard;
      const Featured = value.slots?.featured;
      return <main className="borough-directory">
        <header className="borough-directory-heading"><p className="borough-eyebrow">The local index</p>
          <h1>Places with a point of view.</h1><p>{value.description}</p></header>
        <div className="borough-directory-layout">
          <aside><div className="borough-filter-title">Refine the guide</div>{value.facets}</aside>
          <section aria-label="Directory results" className="borough-results">
            <div className="borough-results-heading"><h2>{value.total} local {value.total === 1 ? "place" : "places"}</h2>
              <span>Current, public recommendations</span></div>
            {Featured
              ? <Featured listings={value.featured} fields={value.fields}
                mediaAssets={value.mediaAssets} iconLibrary={value.iconLibrary} Card={Card} />
              : value.featured.length > 0 && <section className="borough-paid-picks"
                aria-label="Featured listings">
                <div><p>Featured places</p><span>Paid placements matching these filters.</span></div>
                <div className="borough-card-grid">{value.featured.map((listing) =>
                  <div key={listing.slug} data-borough-featured={listing.slug}>
                    <Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets}
                      iconLibrary={value.iconLibrary} highlighted />
                  </div>)}</div>
              </section>}
            {value.listings.length === 0
              ? <section className="borough-empty" aria-live="polite">
                <strong>This route is quiet today.</strong>
                <span>Clear a filter to return to the full city guide.</span>
                <TemplateLink href="/listings">Browse every place</TemplateLink>
              </section>
              : <div className="borough-card-grid">{value.listings.map((listing) =>
                <div key={listing.slug} data-borough-result={listing.slug}>
                  <Card listing={listing} fields={value.fields} mediaAssets={value.mediaAssets}
                    iconLibrary={value.iconLibrary} />
                </div>)}</div>}
            <TemplatePagination value={value.pagination} />
          </section>
        </div>
      </main>;
    },
    listing(detail) {
      const image = detail.image ?? photo(detail.listing, detail.mediaAssets);
      return <main className="borough-detail">
        <TemplateLink href="/listings" className="borough-back">← All places</TemplateLink>
        <header><div><p className="borough-eyebrow">{words(facts(detail.listing).neighborhood)}</p>
          <h1>{detail.listing.name}</h1><p>{detail.listing.summary}</p></div>
          {image && <TemplateContentImage asset={image} />}</header>
        <div className="borough-detail-grid">
          <article><p className="borough-eyebrow">Why it belongs in the guide</p>
            <TemplateMarkdown source={detail.listing.description} />
            <div className="borough-curator"><span>Curator note</span>
              <TemplateProfileValues fields={detail.fields.filter(({ key }) => key.endsWith(".curator-note"))}
                listing={detail.listing} mediaAssets={detail.mediaAssets} /></div>
            <div className="borough-actions"><a href={detail.listing.url} target="_blank"
              rel="noopener noreferrer">Visit this place ↗</a>
              <a href={detail.markdownHref} type="text/markdown" rel="alternate">Markdown</a></div>
          </article>
          <aside><p className="borough-eyebrow">Plan your visit</p>
            <TemplateProfileValues fields={detail.fields.filter(({ key }) =>
              !key.endsWith(".curator-note") && !key.endsWith(".photography"))}
              listing={detail.listing} mediaAssets={detail.mediaAssets} /></aside>
        </div>
      </main>;
    },
    pagination({ value }) {
      return <TemplatePagination value={value} />;
    },
    footer({ site, navigation }) {
      return <footer className="borough-footer"><div><strong>BOROUGH</strong>
        <p>The city, known by locals.</p><span>{site.name}</span></div>
        <nav aria-label="Footer navigation">{navigation.map((item) =>
          <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}</nav></footer>;
    },
  },
} satisfies PublicTemplateDefinition;

export default boroughTemplate;
