import { connection } from "next/server";
import { publicMediaAsset } from "@/lib/media";
import { mediaFileResponse } from "@/lib/media-routes";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await connection();
  const asset = publicMediaAsset((await params).id);
  if (!asset) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return mediaFileResponse(asset);
}
