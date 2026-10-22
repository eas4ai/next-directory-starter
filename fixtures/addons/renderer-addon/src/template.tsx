import type { PublicTemplateDefinition } from "@/lib/public-template-sdk";
import { TemplateLink } from "@/components/public-template-primitives";

const rendererAddon = {
  id: "renderer-addon",
  name: "Renderer Grid",
  renderers: {
    home({ site }) {
      return <main className="site-container template-hero" data-renderer-addon="home">
        <p>{site.name}</p>
        <h1>Renderer add-on home</h1>
        <p>{site.description}</p>
        <TemplateLink href="/listings">Browse listings</TemplateLink>
      </main>;
    },
  },
} satisfies PublicTemplateDefinition;

export default rendererAddon;
