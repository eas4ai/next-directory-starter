import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Administrator sign in | Directory Starter",
  description: "Sign in to manage the directory theme.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-5xl items-center justify-center px-6 py-12">
      <SignInForm />
    </main>
  );
}
