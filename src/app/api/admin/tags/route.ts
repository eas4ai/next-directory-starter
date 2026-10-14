import { createTaxonomy, listTaxonomy } from "@/lib/taxonomy-routes";

export async function GET(request: Request) {
  return listTaxonomy("tag", request);
}

export async function POST(request: Request) {
  return createTaxonomy("tag", request);
}
