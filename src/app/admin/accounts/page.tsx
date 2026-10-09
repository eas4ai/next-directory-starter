import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAdmin } from "@/lib/admin";
import { managedAccounts } from "@/lib/accounts";
import { getSiteConfig } from "@/lib/site-config";
import { AccountRoles } from "./account-roles";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Accounts | ${getSiteConfig().name}`,
    description: "Private account role management.",
    robots: { index: false, follow: false },
  };
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await connection();
  if (!(await isAdmin(await headers()))) notFound();
  const requestedPage = Number((await searchParams).page ?? "1");
  const { accounts, page, pages } = managedAccounts(requestedPage);
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <Link href="/admin/catalog" className="text-sm text-muted-foreground hover:text-foreground">← Catalog</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Accounts and roles</h1>
      <p className="mt-3 text-muted-foreground">Grant only the access each account needs. The final administrator cannot be demoted.</p>
      <AccountRoles accounts={accounts} />
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Account pages">
          {page > 1 ? <Link href={`/admin/accounts?page=${page - 1}`} className="underline">Previous</Link> : <span />}
          <span>Page {page} of {pages}</span>
          {page < pages ? <Link href={`/admin/accounts?page=${page + 1}`} className="underline">Next</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
