import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAdmin } from "@/lib/admin";
import { recentAuditEvents } from "@/lib/audit";
import { getSiteConfig } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Audit history | ${getSiteConfig().name}`,
    description: "Private history of protected changes.",
    robots: { index: false, follow: false },
  };
}

export default async function AuditPage() {
  await connection();
  if (!(await isAdmin(await headers()))) notFound();
  const events = recentAuditEvents();
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
      <Link href="/admin/catalog" className="text-sm text-muted-foreground hover:text-foreground">← Catalog</Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">Audit history</h1>
      <p className="mt-3 text-muted-foreground">The 100 most recent moderation, publication, plan, and account changes.</p>
      <div className="mt-8 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="border-b bg-muted/40">
            <tr><th className="p-3">When</th><th className="p-3">Action</th><th className="p-3">Actor ID</th><th className="p-3">Target</th></tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b last:border-0">
                <td className="p-3 whitespace-nowrap"><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time></td>
                <td className="p-3">{event.action}</td>
                <td className="p-3 break-all">{event.actorUserId}</td>
                <td className="p-3 break-all">{event.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No protected changes recorded yet.</p>}
    </main>
  );
}
