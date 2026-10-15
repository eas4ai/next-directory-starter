import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DirectoryProfileField } from "@/lib/directory-profile-types";
import type {
  ParsedProfileDirectoryQuery, ProfileDiscoveryDescriptor, ProfileFacetCounts,
} from "@/lib/profile-discovery";

function selected(query: ParsedProfileDirectoryQuery, fieldKey: string): string[] {
  const facet = query.facets[fieldKey];
  return facet && "values" in facet ? facet.values : [];
}

function bound(query: ParsedProfileDirectoryQuery, fieldKey: string, side: "min" | "max"): string {
  const facet = query.facets[fieldKey];
  return facet && !("values" in facet) ? facet[side] ?? "" : "";
}

function countLabel(counts: ProfileFacetCounts, fieldKey: string, value: string): string {
  const count = counts[fieldKey]?.[value];
  return count === undefined ? "" : ` (${count})`;
}

function ChoiceFacet({ field, query, counts }: { field: DirectoryProfileField;
  query: ParsedProfileDirectoryQuery; counts: ProfileFacetCounts }) {
  const options = field.type === "boolean"
    ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }]
    : field.constraints.choices as { value: string; label: string }[];
  const chosen = new Set(selected(query, field.key));
  return <fieldset className="profile-facet">
    <legend>{field.facet!.label}</legend>
    <p>{field.facet!.mode === "all" ? "Match every selected value" : "Match any selected value"}</p>
    <div className="profile-facet-options">{options.map((option) =>
      <label key={option.value}>
        <input type="checkbox" name={`facet.${field.key}`} value={option.value}
          defaultChecked={chosen.has(option.value)} />
        <span>{option.label}{countLabel(counts, field.key, option.value)}</span>
      </label>)}</div>
  </fieldset>;
}

function rangeInput(field: DirectoryProfileField): { type: "text" | "number" | "date"; step?: string;
  placeholder?: string } {
  if (field.type === "date" || field.type === "date-range") return { type: "date" };
  if (field.type === "datetime") return { type: "text", placeholder: "2026-10-15T13:00:00Z" };
  if (field.type === "decimal") return { type: "number",
    step: String(1 / (10 ** Number(field.constraints.scale))) };
  if (field.type === "money") return { type: "text", placeholder: "USD:1000" };
  return { type: "number", step: "1" };
}

function RangeFacet({ field, query }: { field: DirectoryProfileField;
  query: ParsedProfileDirectoryQuery }) {
  const input = rangeInput(field);
  return <fieldset className="profile-facet">
    <legend>{field.facet!.label}</legend>
    <div className="profile-range">
      <label>Minimum
        <Input name={`min.${field.key}`} defaultValue={bound(query, field.key, "min")}
          type={input.type} step={input.step} placeholder={input.placeholder} />
      </label>
      <label>Maximum
        <Input name={`max.${field.key}`} defaultValue={bound(query, field.key, "max")}
          type={input.type} step={input.step} placeholder={input.placeholder} />
      </label>
    </div>
  </fieldset>;
}

function LocationFacet({ field, query }: { field: DirectoryProfileField;
  query: ParsedProfileDirectoryQuery }) {
  return <fieldset className="profile-facet">
    <legend>{field.facet!.label}</legend>
    <label>Country, region, and locality
      <Input name={`facet.${field.key}`} defaultValue={selected(query, field.key)[0] ?? ""}
        placeholder="US|NY|New York" />
    </label>
  </fieldset>;
}

function FacetControl({ descriptor, query, counts }: { descriptor: ProfileDiscoveryDescriptor;
  query: ParsedProfileDirectoryQuery; counts: ProfileFacetCounts }) {
  const { field } = descriptor;
  if (["boolean", "single-choice", "multiple-choice"].includes(field.type)) {
    return <ChoiceFacet field={field} query={query} counts={counts} />;
  }
  if (field.type === "location") return <LocationFacet field={field} query={query} />;
  return <RangeFacet field={field} query={query} />;
}

export function ProfileFacets({ descriptors, query, facetCounts, categories }: {
  descriptors: ProfileDiscoveryDescriptor[];
  query: ParsedProfileDirectoryQuery;
  facetCounts: ProfileFacetCounts;
  categories: string[];
}) {
  const facets = descriptors.filter(({ field }) => field.facet !== null);
  const sorts = descriptors.filter(({ field }) => field.sort !== null);
  const selectedCategory = categories.find((item) =>
    item.toLowerCase() === query.category.toLowerCase()) ?? query.category;
  return <form action="/listings" method="get" className="profile-facets">
    {query.invalid && <p role="alert" className="profile-query-error">
      The directory filters were invalid. Clear them and try again.
    </p>}
    <div className="profile-core-filters">
      <label htmlFor="directory-query">Search
        <Input id="directory-query" name="q" defaultValue={query.q} placeholder="Search listings" />
      </label>
      <label htmlFor="directory-category">Category
        <select id="directory-category" name="category" defaultValue={selectedCategory}>
          <option value="">All categories</option>
          {query.category && !categories.includes(selectedCategory) &&
            <option value={selectedCategory}>Unknown category</option>}
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      {sorts.length > 0 && <label htmlFor="directory-sort">Sort
        <select id="directory-sort" name="sort"
          defaultValue={query.sort ? `${query.sort.fieldKey}:${query.sort.direction}` : ""}>
          <option value="">Name</option>
          {sorts.flatMap(({ field }) => field.sort!.directions.map((direction) =>
            <option key={`${field.key}:${direction}`} value={`${field.key}:${direction}`}>
              {field.sort!.label} ({direction === "asc" ? "ascending" : "descending"})
            </option>))}
        </select>
      </label>}
    </div>
    {facets.length > 0 && <div className="profile-facet-grid">
      {facets.map((descriptor) => <FacetControl key={descriptor.field.key}
        descriptor={descriptor} query={query} counts={facetCounts} />)}
    </div>}
    <div className="profile-facet-actions">
      <Button type="submit">Apply filters</Button>
      <Button variant="outline" asChild><Link href="/listings">Clear filters</Link></Button>
    </div>
  </form>;
}
