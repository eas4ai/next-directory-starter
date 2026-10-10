import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { canManageCatalog, sessionUser } from "@/lib/admin";
import { listAgentKeys } from "@/lib/agent-keys";
import { listAgentImports } from "@/lib/agent-imports";
import { directoryCategories } from "@/lib/listings";
import { getSiteConfig } from "@/lib/site-config";
import { ImportWorkspace } from "./import-workspace";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return { title: `Agent imports | ${getSiteConfig().name}`, robots: { index: false, follow: false } };
}

export default async function ImportPage() {
  const user = await sessionUser(await headers());
  if (!user || !canManageCatalog(user.role)) notFound();
  return (
    <main className="mx-auto w-full max-w-[1100px] px-6 py-10">
      <Link href="/admin/catalog" className="text-sm underline">← Catalog</Link>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">Agent imports</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Collect links with agent-browser, stage grounded descriptions as private drafts,
        then review and publish each one. This page exposes WebMCP tools in supported browsers.
      </p>
      <ImportWorkspace initialKeys={listAgentKeys(user.id)}
        initialImports={listAgentImports()} categories={directoryCategories()} />
    </main>
  );
}
