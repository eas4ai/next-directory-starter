import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { isAdmin } from "@/lib/admin";
import { notificationDeliveryRows } from "@/lib/notification-delivery";
import { getSiteConfig } from "@/lib/site-config";
import { RetryButton } from "./retry-button";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return { title: `Notification delivery | ${getSiteConfig().name}`,
    robots: { index: false, follow: false } };
}

export default async function NotificationDeliveryPage() {
  await connection();
  if (!(await isAdmin(await headers()))) notFound();
  const rows = notificationDeliveryRows();
  return <main className="mx-auto w-full max-w-[1400px] px-6 py-10">
    <Link href="/admin/audit" className="text-sm underline">← Audit history</Link>
    <h1 className="mt-7 text-3xl font-semibold tracking-tight">Notification delivery</h1>
    <p className="mt-3 max-w-3xl text-sm text-muted-foreground">Latest 100 owner emails. The bounded worker sends due notices through Resend. Failed deliveries show their next attempt; after five attempts an operator can retry without repeating the underlying moderation or payment action. Inspect Resend logs before retrying an unknown delivery outcome.</p>
    <div className="mt-8 space-y-3">
      {rows.map((row) => <article key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
        <div className="min-w-0">
          <h2 className="break-words font-medium">{row.subject}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{row.emailState} · {row.emailAttempts} attempts</p>
          {row.emailNextAttemptAt && <p className="text-xs text-muted-foreground">Next attempt {new Date(row.emailNextAttemptAt).toLocaleString()}</p>}
          {row.emailLastError && <p className="text-xs text-destructive">{row.emailLastError}</p>}
        </div>
        {row.emailState === "failed" && !row.emailNextAttemptAt && <RetryButton id={row.id} />}
      </article>)}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No notification emails yet.</p>}
    </div>
  </main>;
}
