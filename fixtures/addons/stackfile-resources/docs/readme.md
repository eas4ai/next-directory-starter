# stackfile Developer Resources

stackfile is a complete developer-resource directory for Next Directory Starter 1.2 or later. It includes a documentation-dense dark theme, compact server-rendered layouts, a versioned technical profile, an original layered mark, and eight original explanatory product visuals.

## Install

```sh
npm run addon:validate -- ./stackfile-resources.zip
npm run addon:install -- ./stackfile-resources.zip
npm run db:migrate
npm run build
```

Activate `stackfile-resources.resources@1.0.0` in `/admin/profiles`, then preview and select stackfile in `/admin/theme`. Add the fictional sample catalog only when wanted:

```sh
npm run addon:seed -- stackfile-resources
```

## Product behavior

- Type, language, framework, runtime, platform, license, maintenance, pricing, open-source, search, release, and sort controls use server-rendered GET requests.
- Compatibility, current version, last release, license, maintenance, repository, and operator review date stay visible as labeled facts.
- Publisher-supplied install commands render only as inert text. stackfile never executes them.
- Publisher claims and links remain distinct from the operator-owned last-reviewed date.
- The seed contains fourteen fictional resources, one draft, eight original diagrams, and unique release dates for deterministic sorting.

Removing the add-on restores unchanged source while retaining explicitly seeded data and runtime media. A selected stackfile design falls back to the starter defaults.
