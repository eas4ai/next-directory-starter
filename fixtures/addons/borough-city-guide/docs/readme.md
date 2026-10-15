# BOROUGH Local City Guide

BOROUGH turns the directory starter into an editorial neighborhood guide. Photography and operator-authored local notes lead the public experience. Search, filters, sorting, neighborhood collections, and curated trails use the active directory profile and current eligible public records.

## Install

Validate and install the archive with the starter's add-on commands. Installation copies owned source only. It does not open the operator database or create media.

After installation:

1. Run the starter's database migrations.
2. Activate `borough-city-guide.places@1.0.0` in the directory profile administration screen.
3. Select the `BOROUGH` theme and `BOROUGH Local City Guide` template in the theme editor.
4. Optionally run the explicit add-on seed command for `borough-city-guide`.

The explicit seed adds nine representative places and their packaged photographs. One place remains a draft to demonstrate public eligibility. Repeating the same seed is idempotent.

## Profile

The profile defines neighborhood, place type, address, location, price level, accessibility, best-for tags, visit duration, curator note, editorial-pick state, curated trails, and photography. Curator notes, editorial picks, trails, and packaged photography remain operator controlled.

Curated trails are public place collections represented by profile values and shareable filtered directory URLs. They do not create visitor accounts, bookmarks, or saved favorites.

## Media behavior

Packaged seed images are checked for safe declared paths, ownership, integrity, supported type, byte limit, dimensions, and single-frame decoding. Explicit seeding normalizes them to runtime WebP media. A failure rolls back listing, profile, and media records and removes new runtime files. Backups include the files. Removing the add-on preserves explicitly seeded records and media.

## Customization

Operators can replace the sample records through the normal catalog workflow after seeding. The homepage reads current eligible public data on every request, so edits, suspensions, bans, and media visibility changes appear without editing the BOROUGH renderer.

The design tokens live in `src/theme.ts`; the composition and responsive rules live in `src/template.tsx` and `src/template.css`. Keep the two-pixel geometry, editorial spacing, serif display hierarchy, quiet controls, and distinct brick action and sage support roles when extending the design.
