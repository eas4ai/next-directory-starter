# Directory Profiles and Facets Design

**Date:** 2026-10-14

## Purpose

Next Directory Starter needs one production data standard that can support the
ten planned directory families without giving each visual template its own
database design. The first consumer will be the VECTOR AI tools package, but
the standard must also represent places, experts, agencies, developer
resources, courses, restaurants, travel experiences, events, and home
services.

A directory profile describes the structured data and discovery behavior for a
directory. A public template describes presentation. A theme describes visual
tokens. These contracts remain separate so an operator can change a template
or theme without changing catalog data.

## Product standard

This is a production feature. Every supported field and lifecycle operation
includes validation, authorization, persistence, migrations, failure recovery,
accessible operator and public interfaces, documentation, and verification.
The work does not ship placeholder controls, raw JSON editing, or workflows
that rely on a later template to become usable.

## Profile contract

A profile has a stable namespaced ID, semantic version, display name, digest,
and immutable field definition. An add-on can package profiles alongside
themes, templates, assets, and seed content. Operators can add site-owned
fields in a separate namespace.

Each field declares:

- a stable key, label, help text, type, cardinality, default, and constraints;
- operator, owner, or system write access;
- public, staff, or private visibility;
- card, badge, detail section, or hidden placement;
- search, filter, and sort behavior; and
- an optional group and display order.

The standard supports short text, Markdown text, boolean, integer, decimal,
money, single choice, multiple choice, URL, date, date/time, date range,
duration, structured location, media references, and repeatable structured
groups. Constraints are specific to the field type and bounded. Repeatable
groups have stable item identities and bounded child fields so edits and
migrations do not depend on array position.

## Ownership and lifecycle

Installing an add-on validates and statically registers its profile source. It
does not open or change the operator database. A protected administrator flow
performs database operations explicitly.

Activation validates the complete definition, reports its effect on existing
listings, stores an immutable definition and digest in SQLite, and changes the
active profile in one transaction. The database snapshot remains authoritative
if the source add-on is later removed.

Profile versions are immutable. A compatible upgrade may add optional fields,
widen safe constraints, or add choices without invalidating stored values. A
breaking upgrade must show affected listing counts and require an explicit
mapping or archival choice for renamed, removed, narrowed, or type-changed
fields. A failed or stale migration changes no active definition or value.
Prior definitions and archived values remain available for audit and recovery.

Switching profiles uses the same impact report and mapping rules. Core listing
identity remains shared. Values owned by inactive profiles remain stored.
Site-owned fields form a separate layer and follow the same version and impact
rules.

## Persistence and revisions

Profile definitions and values use normalized, typed SQLite records with
indexes for the supported search, facet, and sort operations. Typed storage
prevents ambiguous string coercion and keeps numeric, money, boolean, date, and
location comparisons correct. Money values carry a currency. Structured and
repeatable values keep stable identities and ordering.

The existing listing revision is the concurrency boundary for core and profile
values. Administrator and owner APIs validate the complete submitted record on
the server. Owner changes snapshot profile values with the private proposal;
moderation approves core and profile values as one revision. Stale writes,
profile version races, and unauthorized field changes fail without a partial
write.

Removing a field archives its values. Permanent deletion is a separate
protected purge with an impact count and audit record. A new required field
cannot activate until every affected published record has a valid value or an
explicit migration supplies one.

## Authoring experience

Administrator and owner forms generate appropriate accessible controls from
the active profile. Type-specific labels, help, constraints, errors, groups,
and repeatable items are visible without requiring an operator to edit JSON.
Fields respect their write permission and visibility. Server validation is
authoritative and uses bounded request bodies. URL, Markdown, and media fields
reuse the starter's safe-link, active-content, ownership, and public-eligibility
rules.

Profile activation, customization, migration, switching, archival, and purge
actions create audit records. Owners see only fields they can edit. Staff can
inspect private and archived values only through existing capability checks.

Agent imports may stage records that lack required profile values. Publication
remains blocked until an authorized editor supplies and validates the required
fields.

## Public discovery

The active profile generates server-rendered discovery controls. Text search
covers core listing content and fields explicitly marked searchable. Facets
support choices, booleans, numeric and money ranges, dates and date ranges,
duration, and structured location. A profile declares whether multiple values
within one facet match any or all; different facets combine with AND.

The profile allowlists sort choices and every sort has a stable tie breaker.
Filter and sort state uses bounded GET parameters, survives pagination, and is
shareable. Invalid, unknown, excessive, staff-only, and private parameters fail
safely without disclosing hidden values.

Filtered and sorted variants remain nonindexable and identify the unfiltered
directory as canonical. Only approved public values can affect public results,
facet counts, cards, details, Markdown, feeds, metadata, social cards, or
structured data.

The generic public renderer displays configured badges, summary facts, grouped
details, money, dates, locations, links, media, and repeatable groups. It makes
the profile useful before a specialized template is installed. Queries fetch
values in batches and use bounded indexed operations. Forms and results work
without client JavaScript, support keyboard use, and remain readable at 320
pixels in light and dark modes.

## Add-ons, seeding, and operations

The add-on manifest gains versioned profile declarations whose schema files are
part of the package integrity and ownership record. Package validation rejects
unsafe paths, duplicate profile or field identities, unknown types, invalid
defaults, unsafe URLs, contradictory permissions, incompatible constraints,
and definitions above documented bounds before installation writes.

Sample data names the intended profile version and supplies typed field values.
The explicit seed command validates the full batch and applies it once in a
transaction. Repeated seeding is idempotent. Add-on installation and removal
continue to avoid database writes, and removal leaves activated profile
snapshots and catalog values intact.

The existing database backup contains profile definitions, custom fields,
values, archived values, and migration history. Restore validation and upgrade
guidance cover them. Import, seed, backup, restore, and add-on operations use
the same profile validation rules as interactive writes.

## Failure behavior

- Activation, switching, and migrations are transactional and revision checked.
- Concurrent schema and listing edits either serialize or reject a stale write.
- Invalid definitions and values fail before durable state changes.
- Missing packaged profile source does not make its database snapshot unusable.
- Schema bounds cap fields, choices, group sizes, values, query parameters, and
  migration work per operation.
- Public queries never read private, staff-only, draft, rejected, suspended, or
  otherwise ineligible values.

## Verification

A `directory-profiles` mechanism runs each requirement independently. It covers
schema validation, every field family, generated forms, server authorization,
owner moderation, stale writes, public rendering, facet and sort semantics,
query bounds, SEO headers and canonical URLs, seed and import behavior, add-on
registration and removal, upgrades and rollback, concurrent changes,
backup/restore, keyboard access, and 320-pixel layouts.

Violating examples must reach the behavior named by each requirement. Shared
setup failures do not count as requirement-specific red evidence.

## Delivery sequence

This commitment delivers the complete profile and facet standard. Later
complete commitments can build comparison and saved collections, trust and
conversion workflows, time-based schedules, and portfolio records on this
contract. VECTOR begins after the capabilities it presents are complete.
