import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";
import { connection } from "next/server";
import { getSiteConfig } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: `Administrator sign in | ${getSiteConfig().name}`,
    description: `Sign in to manage ${getSiteConfig().name}.`,
    robots: { index: false, follow: false },
  };
}

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full theme-page-width items-center justify-center px-6 py-12">
      <SignInForm />
    </main>
  );
}
