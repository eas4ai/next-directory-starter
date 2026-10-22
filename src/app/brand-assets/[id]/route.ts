import { connection } from "next/server";
import { brandAssetResponse } from "@/lib/branding";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  return brandAssetResponse((await context.params).id);
}
