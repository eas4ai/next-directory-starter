"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requestRecoveryEmail } from "@/lib/recovery-request";

export function RecoveryForm({ token }: { token?: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      if (token) {
        const result = await authClient.resetPassword({
          token,
          newPassword: String(values.get("password")),
        });
        if (result.error) {
          setError("This reset link is invalid or expired. Request a new one.");
          return;
        }
        setMessage("Password updated. Sign in with your new password.");
      } else {
        const outcome = await requestRecoveryEmail(
          (input) => authClient.requestPasswordReset(input),
          {
            email: String(values.get("email")),
            redirectTo: `${window.location.origin}/owner/reset-password`,
          },
        );
        setMessage(outcome.message);
        setError(outcome.error);
      }
    } catch {
      setError("Unable to connect. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle><h1>{token ? "Set a new password" : "Reset your password"}</h1></CardTitle>
        <CardDescription>{token ? "Choose a new password for your account." : "Enter your account email to request a reset link."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!message && <form onSubmit={submit} className="space-y-4">
          {token
            ? <label className="grid gap-2 text-sm font-medium">New password<Input name="password" type="password" minLength={8} required autoComplete="new-password" /></label>
            : <label className="grid gap-2 text-sm font-medium">Email<Input name="email" type="email" required autoComplete="email" /></label>}
          <Button type="submit" disabled={pending} className="w-full">{pending ? "Please wait…" : token ? "Update password" : "Send reset link"}</Button>
        </form>}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Link href="/owner/sign-in" className="text-sm text-primary underline-offset-4 hover:underline">Back to sign in</Link>
      </CardContent>
    </Card>
  );
}
