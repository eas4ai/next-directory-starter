# Next Directory Starter — overview

## What it is

Next Directory Starter is a reusable link directory application starter. It
uses `devlist.app` as the functional reference while replacing its Rust and Vue
application stack with a current stable Next.js App Router application, React,
and shadcn/ui components. A new operator can configure a directory's name,
domain, categories, and content, then run a public directory with editorial
and administrative workflows. An authenticated administrator can preview and
save the site's shadcn/ui theme preset. Public discovery pages render their content on
the server so people and crawlers can read them without client-side JavaScript.

## Problem

Building a directory from scratch repeats the same work: a searchable catalog,
listing pages, controlled publication, site administration, and crawlable
metadata. The starter provides those pieces as a coherent base that can be
adapted to a subject other than developer resources.

## What it is not

- It is not the DevList brand, dataset, or a byte-for-byte port of its code.
- It is not a package registry or file host; listings describe and link to
  resources elsewhere.
- It is not a production directory for one topic; an operator chooses the
  topic and content.
- It does not promise search ranking. It exposes accurate server-rendered pages
  and crawler metadata that an operator can publish.

## Spec map

| Domain | File | Prefix |
| --- | --- | --- |
| Starter configuration, setup, and deployment | foundation.md | FOUND |
| Visitor light and dark appearance | appearance.md | UI |
| Backup, restore, and upgrade operations | operations.md | OPS |
| Account verification, recovery, magic links, and suspension | accounts.md | ACC |
| Public discovery, search, categories, and listing pages | directory.md | DIR |
| Accounts, ownership, submission, and moderation | publishing.md | PUB |
| Editorial articles and taxonomy | editorial.md | EDIT |
| Private uploads and public media eligibility | media.md | MED |
| Durable owner notices and Resend delivery | notifications.md | NOTIFY |
| Paid publication and featured placement | commerce.md | COM |
| Server rendering, metadata, and crawl controls | seo.md | SEO |
| Administrative controls, theme editor, and audit history | administration.md | ADM |
| Agent-assisted link imports and social cards | agent-ingestion.md | ING |
