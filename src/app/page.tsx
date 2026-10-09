import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-5xl flex-col justify-center px-6 py-20">
      <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">Directory Starter</p>
      <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-tight">The useful links, all in one place.</h1>
      <p className="mt-6 max-w-xl text-lg text-muted-foreground">A simple starting point for a curated directory. Replace the sample listings with your own.</p>
      <div className="mt-8"><Button asChild><Link href="/listings">Browse listings</Link></Button></div>
    </main>
  );
}
