import { connection } from "next/server";
import { sessionUser } from "@/lib/admin";
import { mediaErrorResponse, privateMediaAsset } from "@/lib/media";
import { mediaFileResponse } from "@/lib/media-routes";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await connection();
  const user = await sessionUser(request.headers);
  if (!user) return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    return mediaFileResponse(privateMediaAsset((await params).id, user.id, user.role));
  } catch (error) {
    return mediaErrorResponse(error);
  }
}
