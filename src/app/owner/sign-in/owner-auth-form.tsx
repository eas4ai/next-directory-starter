"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function OwnerAuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const email = String(values.email);
    const password = String(values.password);
    try {
      const result = mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(values.name) });
      if (result.error) {
        setError(result.error.message ?? "Unable to continue. Check your details.");
        return;
      }
      if (mode === "sign-up") {
        setMessage("Check your email for a verification link, then sign in.");
        return;
      }
      router.replace("/owner/listings");
      router.refresh();
    } catch {
      setError("Unable to connect. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle><h1>{mode === "sign-in" ? "Owner sign in" : "Create owner account"}</h1></CardTitle>
        <CardDescription>Manage your listing drafts and submissions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={submit} className="space-y-4">
          {mode === "sign-up" && <label className="grid gap-2 text-sm font-medium">Name<Input name="name" required autoComplete="name" /></label>}
          <label className="grid gap-2 text-sm font-medium">Email<Input name="email" type="email" required autoComplete="email" /></label>
          <label className="grid gap-2 text-sm font-medium">Password<Input name="password" type="password" minLength={8} required autoComplete={mode === "sign-in" ? "current-password" : "new-password"} /></label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>
        {mode === "sign-in" && <Link href="/owner/forgot-password" className="text-sm text-primary underline-offset-4 hover:underline">Forgot password?</Link>}
        <Button type="button" variant="link" className="px-0" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(""); setMessage(""); }}>
          {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </Button>
      </CardContent>
    </Card>
  );
}
