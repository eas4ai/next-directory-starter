import type {
  PublicTemplateDefinition, PublicTemplateHomeProps, PublicTemplateListing,
} from "@/lib/public-template-sdk";
import {
  TemplateContentImage, TemplateLink, TemplateListingCard, TemplateMarkdown,
  TemplatePagination, TemplateProfileValues,
} from "@/components/public-template-primitives";

const namespace = "now-next-events.events";
const key = (suffix: string) => `${namespace}.${suffix}`;

type GroupItem = { id: string; values: Record<string, unknown> };

const facts = (listing: PublicTemplateListing) => ({
  eventType: listing.profileValues["now-next-events.events.event-type"],
  topics: listing.profileValues["now-next-events.events.topics"],
  attendanceMode: listing.profileValues["now-next-events.events.attendance-mode"],
  startsAt: listing.profileValues["now-next-events.events.starts-at"],
  endsAt: listing.profileValues["now-next-events.events.ends-at"],
  timeZone: listing.profileValues["now-next-events.events.time-zone"],
  venue: listing.profileValues["now-next-events.events.venue"],
  location: listing.profileValues["now-next-events.events.location"],
  price: listing.profileValues["now-next-events.events.price"],
  ticketUrl: listing.profileValues["now-next-events.events.ticket-url"],
  accessibility: listing.profileValues["now-next-events.events.accessibility"],
  speakers: listing.profileValues["now-next-events.events.speakers"],
  schedule: listing.profileValues["now-next-events.events.schedule"],
  eventMedia: listing.profileValues["now-next-events.events.event-media"],
});
const text = (entry: unknown) => typeof entry === "string" ? entry : "";
const group = (entry: unknown): GroupItem[] => {
  if (!Array.isArray(entry)) return [];
  return entry.flatMap((item) => item && typeof item === "object" && "id" in item && "values" in item &&
    typeof item.id === "string" && item.values && typeof item.values === "object"
    ? [{ id: item.id, values: item.values as Record<string, unknown> }] : []);
};
const words = (input: unknown) => typeof input === "string"
  ? input.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") : "";

const mediaIds = (listing: PublicTemplateListing) => {
  const media = facts(listing).eventMedia;
  if (typeof media === "string") return [media];
  if (!Array.isArray(media)) return [];
  return media.flatMap((entry) => entry && typeof entry === "object" && "value" in entry &&
    typeof entry.value === "string" ? [entry.value] : []);
};
const image = (listing: PublicTemplateListing, assets: PublicTemplateHomeProps["mediaAssets"]) => {
  const id = mediaIds(listing)[0];
  return id ? assets.get(id) : undefined;
};
const images = (listing: PublicTemplateListing, assets: PublicTemplateHomeProps["mediaAssets"]) =>
  mediaIds(listing).flatMap((id) => {
    const asset = assets.get(id);
    return asset ? [asset] : [];
  });

const timestamp = (listing: PublicTemplateListing, suffix: "starts-at" | "ends-at") => {
  const listingFacts = facts(listing);
  const parsed = Date.parse(text(suffix === "starts-at" ? listingFacts.startsAt : listingFacts.endsAt));
  return Number.isFinite(parsed) ? parsed : 0;
};
const eventState = (listing: PublicTemplateListing, now = Date.now()) => {
  const startsAt = timestamp(listing, "starts-at");
  const endsAt = timestamp(listing, "ends-at");
  if (now < startsAt) return "upcoming";
  if (now < endsAt) return "in-progress";
  return "past";
};
const dateParts = (listing: PublicTemplateListing) => {
  const startsAt = new Date(timestamp(listing, "starts-at"));
  const timeZone = text(facts(listing).timeZone) || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, month: "short", day: "2-digit", weekday: "short", hour: "numeric", minute: "2-digit",
    }).formatToParts(startsAt);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value ?? "";
    return { month: part("month"), day: part("day"), weekday: part("weekday"),
      time: `${part("hour")}:${part("minute")} ${part("dayPeriod")}`.trim(), timeZone };
  } catch {
    return { month: "UTC", day: String(startsAt.getUTCDate()).padStart(2, "0"),
      weekday: "Event", time: startsAt.toISOString().slice(11, 16), timeZone: "UTC" };
  }
};
const eventRange = (listing: PublicTemplateListing) => {
  const listingFacts = facts(listing);
  const timeZone = text(listingFacts.timeZone) || "UTC";
  const format = (suffix: "starts-at" | "ends-at") => new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(timestamp(listing, suffix)));
  try {
    return `${format("starts-at")} — ${format("ends-at")}`;
  } catch {
    return `${text(listingFacts.startsAt)} — ${text(listingFacts.endsAt)}`;
  }
};
const scheduleTime = (input: unknown, timeZone: string) => {
  const iso = text(input);
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};
const dateHref = (start: Date, end: Date) => {
  const query = new URLSearchParams();
  query.set(`max.${key("starts-at")}`, end.toISOString());
    query.set(`min.${key("ends-at")}`, start.toISOString());
  query.set("sort", `${key("starts-at")}:asc`);
  return `/listings?${query}`;
};
const quickDates = () => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + 86_400_000 - 1);
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today.getTime() - mondayOffset * 86_400_000);
  const sunday = new Date(monday.getTime() + 7 * 86_400_000 - 1);
  return { today: dateHref(today, tomorrow), week: dateHref(monday, sunday) };
};
const facetHref = (suffix: string, selected: string) => {
  const query = new URLSearchParams();
  query.set(`facet.${key(suffix)}`, selected);
  query.set("sort", `${key("starts-at")}:asc`);
  return `/listings?${query}`;
};

const DateRail = ({ listing }: { listing: PublicTemplateListing }) => {
  const date = dateParts(listing);
  return <div className="now-next-date" aria-label={`${date.weekday}, ${date.month} ${date.day}`}>
    <span>{date.month}</span><strong>{date.day}</strong><small>{date.weekday}</small>
  </div>;
};

const QuickDateNav = () => {
  const dates = quickDates();
  return <nav className="now-next-quick-dates" aria-label="Browse events by date">
    <TemplateLink href={`/listings?sort=${key("starts-at")}:asc`}>All Dates</TemplateLink>
    <TemplateLink href={dates.today}>Today</TemplateLink>
    <TemplateLink href={dates.week}>This Week</TemplateLink>
    <TemplateLink href={facetHref("topics", "design")}>Design</TemplateLink>
    <TemplateLink href={facetHref("topics", "technology")}>Tech</TemplateLink>
    <TemplateLink href={facetHref("location", "US|NY|New York")}>New York</TemplateLink>
  </nav>;
};

const nowNextTemplate = {
  id: "now-next-events",
  name: "NOW/NEXT Events & Conferences",
  supportedProfiles: [{ id: "now-next-events.events", range: "^1.0.0" }],
  renderers: {
    header({ site, navigation, appearanceControl }) {
      return <header className="now-next-header">
        <nav className="now-next-nav" aria-label="Main navigation">
          <TemplateLink href="/" className="now-next-wordmark" aria-label={`${site.name} home`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/addons/now-next-events/now-next-mark.svg" width="38" height="38" alt="" />
            <strong>NOW/NEXT</strong>
          </TemplateLink>
          <div className="now-next-nav-links">
            <TemplateLink href={`/listings?sort=${key("starts-at")}:asc`}>Events</TemplateLink>
            <TemplateLink href={facetHref("location", "US|NY|New York")}>Cities</TemplateLink>
            <TemplateLink href="/listings">Speakers</TemplateLink>
            {navigation.filter(({ href }) => href === "/owner/listings").map((item) =>
              <TemplateLink key={item.href} href={item.href} className="now-next-submit">
                List an event
              </TemplateLink>)}
            {appearanceControl}
          </div>
        </nav>
      </header>;
    },
    home({ site, listings, fields, mediaAssets }) {
      const chronological = [...listings].sort((left, right) =>
        timestamp(left, "starts-at") - timestamp(right, "starts-at"));
      const active = chronological.filter((listing) => eventState(listing) !== "past").slice(0, 6);
      const lead = active[0] ?? chronological[0];
      const leadImage = lead ? image(lead, mediaAssets) : undefined;
      const cities = [...new Map(chronological.map((listing) => {
          const location = facts(listing).location as { countryCode?: unknown; region?: unknown;
          locality?: unknown } | undefined;
        const locality = typeof location?.locality === "string" ? location.locality : "Online";
        const token = [location?.countryCode, location?.region, location?.locality]
          .filter((entry): entry is string => typeof entry === "string").join("|");
        return [token || "GB|England|London", locality] as const;
      }))].slice(0, 4);
      return <main className="now-next-home">
        <section className="now-next-hero">
          <div className="now-next-hero-copy"><p className="now-next-kicker">The calendar with a pulse.</p>
            <h1>WHAT&apos;S<br /><span>ON.</span></h1><p>{site.description}</p>
            <form action="/listings" method="get" className="now-next-search">
              <label htmlFor="now-next-query">Find an event</label>
              <div><input id="now-next-query" name="q" placeholder="Topic, speaker, venue…" />
                <button type="submit">Search</button></div>
            </form></div>
          {lead && <TemplateLink href={`/listings/${lead.slug}`} className="now-next-lead"
            data-now-next-event={lead.slug} data-now-next-state={eventState(lead)}>
            <div className="now-next-lead-image">{leadImage && <TemplateContentImage asset={leadImage} />}
              <DateRail listing={lead} /></div>
            <div><span>{eventState(lead).replace("-", " ")}</span><h2>{lead.name}</h2>
                <p>{lead.summary}</p><small>{dateParts(lead).time} · {text(facts(lead).venue)}</small>
                <strong data-now-next-attendance={text(facts(lead).attendanceMode)}>
                  {words(facts(lead).attendanceMode)}
                </strong></div>
          </TemplateLink>}
        </section>
        <QuickDateNav />

        <section className="now-next-this-week" aria-labelledby="now-next-week-heading">
          <header><p className="now-next-kicker">This week / next up</p>
            <h2 id="now-next-week-heading">MAKE<br />A DATE.</h2></header>
          <div className="now-next-poster-grid">{active.map((listing) => {
            const artwork = image(listing, mediaAssets);
            return <article key={listing.slug} data-now-next-event={listing.slug}
              data-now-next-state={eventState(listing)}>
              <TemplateLink href={`/listings/${listing.slug}`}>
                <div className="now-next-poster-art">{artwork && <TemplateContentImage asset={artwork} />}
                  <DateRail listing={listing} /></div>
                <div className="now-next-poster-copy"><span>{words(facts(listing).eventType)}</span>
                  <h3>{listing.name}</h3><p>{text(facts(listing).venue)}</p></div>
              </TemplateLink>
              <TemplateProfileValues fields={fields} listing={listing} mediaAssets={mediaAssets}
                placements={["badge"]} />
            </article>;
          })}</div>
        </section>

        <section className="now-next-cities" aria-labelledby="now-next-cities-heading">
          <div><p className="now-next-kicker">Near me / elsewhere</p>
            <h2 id="now-next-cities-heading">FOLLOW<br />THE SCENE.</h2></div>
          <nav aria-label="Browse by city">{cities.map(([token, city], index) =>
            <TemplateLink key={token} href={facetHref("location", token)}>
              <span>0{index + 1}</span><strong>{city}</strong><em>See events →</em>
            </TemplateLink>)}</nav>
        </section>
      </main>;
    },
    card({ listing, fields, mediaAssets, highlighted }) {
      const artwork = image(listing, mediaAssets);
      const state = eventState(listing);
      const date = dateParts(listing);
      return <article className="now-next-card" data-now-next-state={state}
        data-now-next-attendance-mode={text(facts(listing).attendanceMode)}>
        <TemplateLink href={`/listings/${listing.slug}`}>
          <div className="now-next-card-art">{artwork && <TemplateContentImage asset={artwork} />}
            <DateRail listing={listing} /><span className="now-next-state">{state.replace("-", " ")}</span></div>
          <div className="now-next-card-copy"><p>{words(facts(listing).eventType)} / {date.time}</p>
            <h3>{listing.name}</h3><span>{text(facts(listing).venue)}</span>
            <small data-now-next-time-zone={date.timeZone}>{date.timeZone}</small>
            <strong data-now-next-attendance={text(facts(listing).attendanceMode)}>
              {words(facts(listing).attendanceMode)}
            </strong></div>
        </TemplateLink>
        <TemplateProfileValues fields={fields.filter(({ key: fieldKey }) => fieldKey.endsWith(".topics"))}
          listing={listing} mediaAssets={mediaAssets} placements={["card"]} />
        {highlighted && <small className="now-next-featured">Featured placement</small>}
      </article>;
    },
    directory(valueProps) {
      const Card = valueProps.slots?.card ?? TemplateListingCard;
      const Featured = valueProps.slots?.featured;
      return <main className="now-next-directory">
        <header className="now-next-directory-heading"><p className="now-next-kicker">Explore events</p>
          <h1>FIND YOUR<br /><span>NEXT THING.</span></h1><p>{valueProps.description}</p></header>
        <QuickDateNav />
        <div className="now-next-directory-layout">
          <aside><div className="now-next-filter-title">Filter the calendar</div>{valueProps.facets}</aside>
          <section className="now-next-results" aria-label="Directory results">
            <div className="now-next-results-heading"><h2>{valueProps.total} {valueProps.total === 1 ? "event" : "events"}</h2>
              <span>Date and place come first.</span></div>
            {Featured
              ? <Featured listings={valueProps.featured} fields={valueProps.fields}
                mediaAssets={valueProps.mediaAssets} iconLibrary={valueProps.iconLibrary} Card={Card} />
              : valueProps.featured.length > 0 && <section className="now-next-paid" aria-label="Featured events">
                <p>Featured events <span>Paid placements matching these filters.</span></p>
                <div className="now-next-card-grid">{valueProps.featured.map((listing) =>
                  <div key={listing.slug} data-now-next-featured={listing.slug}>
                    <Card listing={listing} fields={valueProps.fields} mediaAssets={valueProps.mediaAssets}
                      iconLibrary={valueProps.iconLibrary} highlighted />
                  </div>)}</div>
              </section>}
            {valueProps.listings.length === 0
              ? <section className="now-next-empty" aria-live="polite"><strong>Nothing lands on that date.</strong>
                <span>Clear a filter to return to the full calendar.</span>
                <TemplateLink href="/listings">Browse all dates</TemplateLink></section>
              : <div className="now-next-card-grid">{valueProps.listings.map((listing) =>
                <div key={listing.slug} data-now-next-result={listing.slug}>
                  <Card listing={listing} fields={valueProps.fields} mediaAssets={valueProps.mediaAssets}
                    iconLibrary={valueProps.iconLibrary} />
                </div>)}</div>}
            <TemplatePagination value={valueProps.pagination} />
          </section>
        </div>
      </main>;
    },
    listing(detail) {
        const eventImages = images(detail.listing, detail.mediaAssets);
        const artwork = detail.image ?? eventImages[0];
        const gallery = eventImages.filter(({ id }) => id !== artwork?.id);
      const state = eventState(detail.listing);
      const listingFacts = facts(detail.listing);
      const speakers = group(listingFacts.speakers);
      const schedule = group(listingFacts.schedule);
      const ticketUrl = text(listingFacts.ticketUrl);
      const factFields = detail.fields.filter(({ key: fieldKey }) =>
        !fieldKey.endsWith(".speakers") && !fieldKey.endsWith(".schedule") &&
        !fieldKey.endsWith(".event-media") && !fieldKey.endsWith(".ticket-url"));
      return <main className="now-next-detail" data-now-next-state={state}>
        <TemplateLink href="/listings" className="now-next-back">← All Dates</TemplateLink>
        <header><div className="now-next-detail-date"><DateRail listing={detail.listing} />
          <span>{state.replace("-", " ")}</span></div>
          <div><p className="now-next-kicker">{words(listingFacts.eventType)}</p>
            <h1>{detail.listing.name}</h1><p>{detail.listing.summary}</p>
            <strong data-now-next-time-zone={text(listingFacts.timeZone)}>
              {eventRange(detail.listing)}</strong></div></header>
        {artwork && <div className="now-next-detail-art" data-now-next-gallery-image={artwork.id}>
          <TemplateContentImage asset={artwork} />
        </div>}
        {gallery.length > 0 && <section className="now-next-gallery" aria-label="Event gallery">
          {gallery.map((asset) => <figure key={asset.id} data-now-next-gallery-image={asset.id}>
            <TemplateContentImage asset={asset} />
          </figure>)}
        </section>}
        <div className="now-next-detail-grid">
          <article><p className="now-next-kicker">About the event</p>
            <TemplateMarkdown source={detail.listing.description} />
            <div className="now-next-actions">
                <a href={ticketUrl || detail.listing.url} target="_blank" rel="noopener noreferrer">
                  {ticketUrl ? "Ticket details with organizer ↗" : "Event details with organizer ↗"}
                </a>
              <a href={detail.markdownHref} type="text/markdown" rel="alternate">Markdown</a>
            </div>
            <section className="now-next-schedule" aria-labelledby="now-next-schedule-heading">
              <p className="now-next-kicker">Program</p><h2 id="now-next-schedule-heading">Schedule</h2>
              <ol>{schedule.map((item) => <li key={item.id} data-now-next-schedule={item.id}>
                <time dateTime={text(item.values["starts-at"])}>
                  {scheduleTime(item.values["starts-at"], text(listingFacts.timeZone) || "UTC")}
                </time>
                <div><strong>{String(item.values.title ?? "Session")}</strong>
                  <span>{words(item.values.kind)}</span>
                    {Boolean(item.values.details) && <p>{String(item.values.details)}</p>}</div>
              </li>)}</ol>
            </section>
            <section className="now-next-speakers" aria-labelledby="now-next-speakers-heading">
              <p className="now-next-kicker">On stage</p><h2 id="now-next-speakers-heading">Speakers</h2>
              <div>{speakers.map((item, index) => {
                const portraitId = text(item.values.portrait);
                const portrait = portraitId ? detail.mediaAssets.get(portraitId) : undefined;
                return <article key={item.id} data-now-next-speaker={item.id}>
                {portrait && <div className="now-next-speaker-portrait"
                  data-now-next-speaker-portrait={item.id}><TemplateContentImage asset={portrait} /></div>}
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{String(item.values.name ?? "Speaker")}</strong>
                <p>{String(item.values.role ?? "Program contributor")}</p>
                {Boolean(item.values.organization) && <small>{String(item.values.organization)}</small>}
                  {Boolean(item.values["profile-url"]) && <a href={text(item.values["profile-url"])}
                    target="_blank" rel="noopener noreferrer">Speaker profile ↗</a>}
              </article>})}</div>
            </section>
          </article>
          <aside><p className="now-next-kicker">At a glance</p>
            <TemplateProfileValues fields={factFields} listing={detail.listing}
              mediaAssets={detail.mediaAssets} /></aside>
        </div>
      </main>;
    },
    pagination({ value: pagination }) {
      return <TemplatePagination value={pagination} />;
    },
    footer({ site, navigation }) {
      return <footer className="now-next-footer"><div><strong>NOW/NEXT</strong>
        <p>The calendar with a pulse.</p><span>{site.name}</span></div>
        <nav aria-label="Footer navigation">{navigation.map((item) =>
          <TemplateLink key={item.href} href={item.href}>{item.label}</TemplateLink>)}</nav></footer>;
    },
  },
} satisfies PublicTemplateDefinition;

export default nowNextTemplate;
