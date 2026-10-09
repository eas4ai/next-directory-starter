# Directory Starter

A Next.js App Router starter for a server-rendered link directory. It includes sample public listings, per-page metadata, and an administrator-only shadcn/ui preset editor. Authentication uses Better Auth and site settings use SQLite.

## First run

Use Node.js 22.12 or newer and npm. From a fresh clone:

```sh
npm ci
cp .env.example .env.local
```

Edit `.env.local`. Set `BETTER_AUTH_SECRET` to a unique value from `openssl rand -base64 32`. Keep `BETTER_AUTH_URL` and `SITE_URL` equal to the URL at which you will open the site. The example values work for local development at `http://localhost:3000`.

Set `SITE_NAME` and `SITE_DESCRIPTION` to identify your directory. Set `SITE_LOGO_URL` and `SITE_ICON_URL` to site-relative paths or HTTP(S) asset URLs. Put site-relative assets in `public/` and refer to them with paths such as `/brand/logo.svg`. These settings change the public header and page metadata without editing application code.

Initialize the database, seed sample listings, and create the first administrator:

```sh
npm run db:migrate
npm run db:seed
npm run account:provision -- --email you@example.com --name "Site administrator"
npm run dev
```

The provisioning command prompts for a password. Open [the administrator sign-in page](http://localhost:3000/admin/sign-in), sign in with that account, then open `/admin/theme` to preview and save a preset or `/admin/catalog` to create and publish listings. Public sign-ups receive the regular user role and cannot access the editors. Do not use `--force` for routine provisioning.

The sample seed is repeatable and leaves existing listings unchanged. The public directory supports `q`, `category`, and `page` URL parameters and shows at most 12 listings per page. Draft and suspended listings are absent from public pages.

## Deploying

Set `BETTER_AUTH_URL` and `SITE_URL` to the site's public HTTPS origin. Set `BETTER_AUTH_SECRET` to a unique secret and `DATABASE_URL` to a writable, persistent SQLite file, then run `npm run db:migrate` and provision an administrator using the same environment as the running application. Back up the SQLite file. The ignored `.runtime/directory.db` default is intended for local development; production storage must survive builds and deployments.

Run `npm run build` and `npm run start` to serve the production build. Change the sample records in `fixtures/sample-listings.json` before seeding a fresh database, or use `/admin/catalog` to add your own listings. Records marked `draft` stay off public pages. Existing databases keep their content when the seed file changes.
