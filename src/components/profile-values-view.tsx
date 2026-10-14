import type { DirectoryProfileField, ProfileValueSet } from "@/lib/directory-profile-types";

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (["string", "number"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map((entry) => {
    if (entry && typeof entry === "object" && "value" in entry) {
      return display((entry as { value: unknown }).value);
    }
    if (entry && typeof entry === "object" && "values" in entry) {
      return Object.values((entry as { values: Record<string, unknown> }).values).map(display).join(" · ");
    }
    return display(entry);
  }).filter(Boolean).join(", ");
  if (typeof value === "object") return Object.entries(value).map(([key, child]) =>
    `${key}: ${display(child)}`).join(" · ");
  return "";
}

export function ProfileValuesView({ fields, values, mode = "public" }: {
  fields: DirectoryProfileField[]; values: ProfileValueSet; mode?: "public" | "staff";
}) {
  const definitions = new Map(fields.map((field) => [field.key, field]));
  const entries = Object.entries(values).filter(([key]) => {
    const field = definitions.get(key);
    return mode === "staff" ? Boolean(field) : field?.visibility === "public";
  });
  if (!entries.length) return null;
  return <dl className="grid gap-3 sm:grid-cols-2">
    {entries.map(([key, value]) => <div key={key} className="min-w-0 rounded-md border p-3">
      <dt className="text-xs font-medium text-muted-foreground">{definitions.get(key)?.label ?? key}</dt>
      <dd className="mt-1 wrap-anywhere text-sm whitespace-pre-wrap">{display(value)}</dd>
    </div>)}
  </dl>;
}
