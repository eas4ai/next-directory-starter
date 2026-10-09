import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";

export const instant = false;

export default async function ThemePage() {
  if (!(await isAdmin(await headers()))) notFound();

  return (
    <main>
      <h1>Site theme</h1>
      <p>Theme controls will be available here.</p>
    </main>
  );
}
