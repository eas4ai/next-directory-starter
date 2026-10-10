import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { recordNotFound } from "@/lib/seo-redirects";

export default async function NotFoundPage() {
  await connection();
  const requestHeaders = await headers();
  const path = requestHeaders.get("x-directory-path");
  const requestId = requestHeaders.get("x-directory-request-id");
  if (path && requestId) recordNotFound(path, requestId);
  return (
    <main className="mx-auto w-full max-w-[1400px] px-6 py-20">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-3 text-3xl font-semibold">Page not found</h1>
      <p className="mt-4 text-muted-foreground">This address is unavailable. Try the directory index.</p>
      <Link href="/listings" className="mt-6 inline-block underline">Browse listings</Link>
    </main>
  );
}
