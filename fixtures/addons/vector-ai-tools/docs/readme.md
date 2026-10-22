# VECTOR AI Tools Directory

VECTOR is a complete comparison-first AI tools directory product for Next Directory Starter 1.2 or later. It includes the VECTOR theme, public renderers, a versioned AI tools profile, original product marks, realistic sample records, dense server-rendered discovery controls, and a two-to-four-tool comparison view.

## Install

```sh
npm run addon:validate -- ./vector-ai-tools.zip
npm run addon:install -- ./vector-ai-tools.zip
npm run db:migrate
npm run build
```

In `/admin/profiles`, analyze and activate `vector-ai-tools.ai-tools@1.0.0`. Sample data remains opt in:

```sh
npm run addon:seed -- vector-ai-tools
```

Open `/admin/theme`, preview the VECTOR theme and VECTOR AI Tools template, then save both selections. Installation does not activate the profile, select the design, or write sample data.

## Product behavior

- `/listings` supplies search, category, pricing, free-tier, platform, integration, open-source, verification, launch-status, launch-date, and sort controls through ordinary GET forms.
- Select two to four published tools and submit **Compare selected** to open `/compare`.
- Action blue marks links and active controls. Signal mint is reserved for verified facts.
- The public pages render on the server and work without client JavaScript.
- Product marks and the stack diagram are original namespaced SVG assets; the package includes no stock photography.

## Remove

Return any locally edited owned files to their installed bytes, then run:

```sh
npm run addon:remove -- vector-ai-tools
npm run build
```

Removal deletes unchanged package source and public assets. It leaves activated profile snapshots and explicitly seeded operator data in the database. A saved VECTOR selection safely falls back to the starter default after removal.
