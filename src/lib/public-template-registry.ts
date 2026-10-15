import { addonTemplateDefinitions } from "@/addons/generated";
import { definePublicTemplate, type PublicTemplateDefinition } from "@/lib/public-template-sdk";

const definitions = Object.fromEntries(addonTemplateDefinitions.map((value) => {
  const definition = definePublicTemplate(value);
  return [definition.id, definition];
})) as Record<string, PublicTemplateDefinition>;

if (Object.keys(definitions).length !== addonTemplateDefinitions.length) {
  throw new Error("Public template renderer IDs must be unique");
}

export function publicTemplateDefinition(id: string): PublicTemplateDefinition | undefined {
  return definitions[id];
}
