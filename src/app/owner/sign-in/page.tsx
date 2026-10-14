import type { Metadata } from "next";
import Link from "next/link";
import { getSiteConfig } from "@/lib/site-config";
import { OwnerAuthForm } from "./owner-auth-form";

export const metadata: Metadata = {
  title: "Owner sign in",
  robots: { index: false, follow: false },
};

export default function OwnerSignInPage() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 py-12">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">← {getSiteConfig().name}</Link>
      <OwnerAuthForm />
    </main>
  );
}
