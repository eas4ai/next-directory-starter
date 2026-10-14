import { removeTaxonomy, renameTaxonomy } from "@/lib/taxonomy-routes";

type Params = { params: Promise<{ name: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return renameTaxonomy("article-category", request, (await params).name);
}

export async function DELETE(request: Request, { params }: Params) {
  return removeTaxonomy("article-category", request, (await params).name);
}
