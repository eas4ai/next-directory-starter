import { currentMediaRoute, uploadMediaRoute } from "@/lib/media-routes";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  return uploadMediaRoute("article", (await params).slug, request);
}

export async function GET(request: Request, { params }: Params) {
  return currentMediaRoute("article", (await params).slug, request);
}
