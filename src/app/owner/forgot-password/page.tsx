import type { Metadata } from "next";
import { RecoveryForm } from "./recovery-form";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return <main className="flex min-h-[70vh] items-center justify-center px-6 py-12"><RecoveryForm /></main>;
}
