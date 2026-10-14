import type { Metadata } from "next";
import Link from "next/link";
import { RecoveryForm } from "../forgot-password/recovery-form";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6 py-12">
      {token
        ? <RecoveryForm token={token} />
        : <p className="text-sm">This reset link is invalid. <Link href="/owner/forgot-password" className="underline">Request another link</Link>.</p>}
    </main>
  );
}
