"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { StoredProfileSummary } from "@/lib/directory-profiles";
import type {
  DirectoryProfileDefinition, DirectoryProfileField, DirectoryProfileState,
  ProfileFieldType, ProfileImpact, ProfileMigrationPlan,
} from "@/lib/directory-profile-types";

const fieldTypes: ProfileFieldType[] = [
  "short-text", "markdown", "boolean", "integer", "decimal", "money",
  "single-choice", "multiple-choice", "url", "date", "datetime", "date-range",
  "duration", "location", "media", "group",
];
const facetTypes = new Set<ProfileFieldType>([
  "boolean", "integer", "decimal", "money", "single-choice", "multiple-choice",
  "date", "date-range", "duration", "location",
]);
const sortTypes = new Set<ProfileFieldType>([
  "short-text", "integer", "decimal", "money", "date", "datetime", "duration",
]);
const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

type ChildDraft = {
  key: string; label: string; help: string; type: Exclude<ProfileFieldType, "group">;
  required: boolean; min: string; max: string; scale: string; options: string;
};
type FieldDraft = {
  key: string; label: string; help: string; type: ProfileFieldType; cardinality: "one" | "many";
  required: boolean; writeAuthority: "operator" | "owner" | "system";
  visibility: "public" | "staff" | "private"; placement: "card" | "badge" | "detail" | "hidden";
  group: string; order: string; searchable: boolean; facet: boolean; facetLabel: string;
  facetMode: "any" | "all"; sort: boolean; sortLabel: string; directions: "asc" | "desc" | "both";
  min: string; max: string; scale: string; options: string; defaultValue: string;
  children: ChildDraft[];
};

const blankChild = (): ChildDraft => ({ key: "", label: "", help: "", type: "short-text",
  required: false, min: "0", max: "120", scale: "2", options: "" });
const blankField = (): FieldDraft => ({
  key: "site.", label: "", help: "", type: "short-text", cardinality: "one",
  required: false, writeAuthority: "operator", visibility: "public", placement: "detail",
  group: "Details", order: "10", searchable: false, facet: false, facetLabel: "",
  facetMode: "any", sort: false, sortLabel: "", directions: "both",
  min: "0", max: "120", scale: "2", options: "", defaultValue: "", children: [],
});

function number(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a whole number`);
  return parsed;
}

function choices(value: string) {
  const rows = value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const at = line.indexOf("|");
    if (at < 1) throw new Error("Each choice must use value|Label on its own line");
    return { value: line.slice(0, at).trim(), label: line.slice(at + 1).trim() };
  });
  if (!rows.length) throw new Error("At least one choice is required");
  return rows;
}

function constraints(type: ProfileFieldType, draft: Pick<FieldDraft, "min" | "max" | "scale" |
  "options" | "children"> | ChildDraft): Record<string, unknown> {
  switch (type) {
    case "short-text":
    case "markdown": return { minLength: number(draft.min, "Minimum length"),
      maxLength: number(draft.max, "Maximum length") };
    case "boolean":
    case "url": return {};
    case "integer": return { min: number(draft.min, "Minimum"), max: number(draft.max, "Maximum") };
    case "decimal": return { min: draft.min, max: draft.max, scale: number(draft.scale, "Scale") };
    case "money": return { minMinor: number(draft.min, "Minimum minor units"),
      maxMinor: number(draft.max, "Maximum minor units"),
      currencies: draft.options.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean) };
    case "single-choice":
    case "multiple-choice": return { choices: choices(draft.options) };
    case "date":
    case "datetime":
    case "date-range": return { min: draft.min, max: draft.max };
    case "duration": return { minSeconds: number(draft.min, "Minimum seconds"),
      maxSeconds: number(draft.max, "Maximum seconds") };
    case "location": return { countries: draft.options.split(",")
      .map((value) => value.trim().toUpperCase()).filter(Boolean) };
    case "media": return { maxItems: number(draft.max, "Maximum media items") };
    case "group": return { minItems: number(draft.min, "Minimum group items"),
      maxItems: number(draft.max, "Maximum group items"),
      children: ("children" in draft ? draft.children : []).map((child: ChildDraft) => ({
        key: child.key, label: child.label,
        help: child.help, type: child.type, required: child.required,
        constraints: constraints(child.type, child) })) };
  }
}

function typedDefault(field: DirectoryProfileField, input: string): unknown {
  const value = input.trim();
  if (!value) return undefined;
  switch (field.type) {
    case "boolean":
      if (!["true", "false"].includes(value)) throw new Error("Boolean defaults use true or false");
      return value === "true";
    case "integer":
    case "duration": return number(value, "Default");
    case "decimal":
    case "single-choice":
    case "url":
    case "date":
    case "datetime":
    case "short-text":
    case "markdown":
    case "media": return value;
    case "multiple-choice": return value.split(",").map((entry) => entry.trim()).filter(Boolean);
    case "money": {
      const [amountMinor, currency] = value.split(/\s+/);
      return { amountMinor: number(amountMinor, "Money default"), currency };
    }
    case "date-range": {
      const [start, end] = value.split("..");
      return { start, end };
    }
    case "location": {
      const [countryCode, region, locality, latitude, longitude] = value.split("|");
      return { countryCode, ...(region ? { region } : {}), ...(locality ? { locality } : {}),
        ...(latitude && longitude ? { latitude: Number(latitude), longitude: Number(longitude) } : {}) };
    }
    case "group": throw new Error("Repeatable group defaults are added through migrations");
  }
}

function fieldFromDraft(draft: FieldDraft): DirectoryProfileField {
  const type = draft.type;
  const cardinality = ["multiple-choice", "group"].includes(type) ? "many" : draft.cardinality;
  const field: DirectoryProfileField = {
    key: draft.key.trim(), label: draft.label.trim(), help: draft.help.trim(), type, cardinality,
    required: draft.required, writeAuthority: draft.writeAuthority, visibility: draft.visibility,
    placement: draft.visibility === "public" ? draft.placement : "hidden",
    group: draft.group.trim() || null, order: number(draft.order, "Display order"),
    searchable: draft.visibility === "public" && ["short-text", "markdown"].includes(type)
      ? draft.searchable : false,
    facet: draft.visibility === "public" && facetTypes.has(type) && draft.facet
      ? { label: draft.facetLabel.trim() || draft.label.trim(), mode: draft.facetMode } : null,
    sort: draft.visibility === "public" && cardinality === "one" && sortTypes.has(type) && draft.sort
      ? { label: draft.sortLabel.trim() || draft.label.trim(),
        directions: draft.directions === "both" ? ["asc", "desc"] : [draft.directions] } : null,
    constraints: constraints(type, draft),
  };
  const defaultValue = typedDefault(field, draft.defaultValue);
  return defaultValue === undefined ? field : { ...field, default: defaultValue };
}

type MappingDraft = { action: "archive" | "map"; to: string; onInvalid: "reject" | "archive" };
type ActiveResponse = { active: DirectoryProfileDefinition[] };

export function ProfileManager({ initialState, initialProfiles, initialActive }: {
  initialState: DirectoryProfileState;
  initialProfiles: StoredProfileSummary[];
  initialActive: DirectoryProfileDefinition[];
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [active, setActive] = useState<DirectoryProfileDefinition[]>(initialActive);
  const selectable = profiles.filter(({ sourceKind }) => sourceKind !== "site");
  const [selected, setSelected] = useState(selectable[0]
    ? `${selectable[0].profileId}@${selectable[0].version}` : "");
  const [impact, setImpact] = useState<ProfileImpact | null>(null);
  const [impactDefinition, setImpactDefinition] = useState<DirectoryProfileDefinition | null>(null);
  const [mappings, setMappings] = useState<Record<string, MappingDraft>>({});
  const [migrationDefaults, setMigrationDefaults] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState(blankField);
  const [fieldStatus, setFieldStatus] = useState("");
  const [purgeProfile, setPurgeProfile] = useState("site.local");
  const [purgeField, setPurgeField] = useState("");
  const [purgeImpact, setPurgeImpact] = useState<number | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const [purgeStatus, setPurgeStatus] = useState("");

  async function refresh() {
    const response = await fetch("/api/admin/profiles", { cache: "no-store" });
    if (!response.ok) throw new Error("Directory profile state could not be refreshed");
    const body = await response.json() as { state: DirectoryProfileState;
      profiles: StoredProfileSummary[] } & ActiveResponse;
    setState(body.state); setProfiles(body.profiles); setActive(body.active);
    router.refresh();
  }
  const site = active.find(({ id }) => id === "site.local");
  const target = useMemo(() => {
    const at = selected.lastIndexOf("@");
    return { profileId: selected.slice(0, at), version: selected.slice(at + 1) };
  }, [selected]);

  function migrationPlan(): ProfileMigrationPlan {
    const fields = Object.fromEntries(Object.entries(mappings).map(([key, value]) =>
      [key, value.action === "archive" ? { action: "archive" } : { action: "map", to: value.to,
        onInvalid: value.onInvalid }])) as ProfileMigrationPlan["fields"];
    const defaults: Record<string, unknown> = {};
    if (impactDefinition) for (const field of impactDefinition.fields) {
      const value = typedDefault(field, migrationDefaults[field.key] ?? "");
      if (value !== undefined) defaults[field.key] = value;
    }
    return { fields, defaults };
  }

  async function analyze() {
    if (!target.profileId || !target.version) return;
    setStatus("Calculating impact…");
    setImpact(null);
    try {
      const response = await fetch("/api/admin/profiles/impact", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target,
          expectedRevision: state.revision, migration: migrationPlan() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Impact analysis failed");
      const definition = body.definition as DirectoryProfileDefinition;
      setImpact(body.impact as ProfileImpact); setImpactDefinition(definition);
      const current = active.find(({ id }) => id === "site.local"
        ? definition.id === "site.local" : id === state.base?.profileId);
      setMappings((prior) => Object.fromEntries((body.impact.breakingFields as string[])
        .filter((key) => current?.fields.some((field) => field.key === key))
        .map((key) => [key, prior[key] ?? (definition.fields.some((field) => field.key === key)
          ? { action: "map", to: key, onInvalid: "reject" }
          : { action: "archive", to: "", onInvalid: "reject" })])));
      setStatus("Impact is current. Review it before activation.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Impact analysis failed"); }
  }

  async function activate() {
    if (!impact) return;
    setStatus("Activating profile…");
    try {
      const response = await fetch("/api/admin/profiles/activate", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target,
          expectedRevision: state.revision, migration: migrationPlan() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Activation failed");
      setImpact(null); setImpactDefinition(null); setMappings({}); setMigrationDefaults({});
      await refresh(); setStatus("Directory profile activated.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Activation failed"); }
  }

  async function saveField(event: FormEvent) {
    event.preventDefault(); setFieldStatus("Saving site field…");
    try {
      const field = fieldFromDraft(draft);
      const response = await fetch("/api/admin/profiles/site-fields", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, expectedRevision: state.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Site field save failed");
      setDraft(blankField()); await refresh(); setFieldStatus("Site field saved as a new immutable version.");
    } catch (error) { setFieldStatus(error instanceof Error ? error.message : "Site field save failed"); }
  }

  async function archiveField(fieldKey: string) {
    setFieldStatus(`Archiving ${fieldKey}…`);
    try {
      const response = await fetch("/api/admin/profiles/site-fields", { method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, expectedRevision: state.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Site field archive failed");
      await refresh(); setFieldStatus(`${fieldKey} archived. Its values remain available for audit.`);
    } catch (error) { setFieldStatus(error instanceof Error ? error.message : "Archive failed"); }
  }

  async function inspectPurge() {
    setPurgeImpact(null); setPurgeConfirmation(""); setPurgeStatus("Counting archived values…");
    try {
      const response = await fetch("/api/admin/profiles/impact", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          purge: { profileId: purgeProfile, fieldKey: purgeField }, expectedRevision: state.revision,
        }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Archived-value impact failed");
      setPurgeImpact(body.purge.archivedCount); setPurgeStatus(
        `${body.purge.archivedCount} archived value rows would be permanently deleted.`);
    } catch (error) { setPurgeStatus(error instanceof Error ? error.message : "Impact failed"); }
  }

  async function purge() {
    if (purgeImpact === null || purgeConfirmation.trim() !== String(purgeImpact)) return;
    setPurgeStatus("Purging archived values…");
    try {
      const response = await fetch("/api/admin/profiles/purge", { method: "DELETE",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          profileId: purgeProfile, fieldKey: purgeField, expectedCount: purgeImpact,
          expectedRevision: state.revision,
        }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Purge failed");
      await refresh(); setPurgeImpact(null); setPurgeConfirmation("");
      setPurgeStatus(`${body.purged} archived value rows were permanently deleted and audited.`);
    } catch (error) { setPurgeStatus(error instanceof Error ? error.message : "Purge failed"); }
  }

  return (
    <div className="mt-10 grid gap-8">
      <Card><CardHeader><CardTitle>Profile activation</CardTitle></CardHeader><CardContent>
        <p className="text-sm text-muted-foreground">State revision {state.revision}. Impact analysis never writes data.</p>
        {selectable.length ? <div className="mt-5 grid gap-4">
          <label className="grid gap-2 text-sm font-medium">Stored profile version
            <select className={inputClass} value={selected} onChange={(event) => {
              setSelected(event.target.value); setImpact(null); setMappings({});
            }}>{selectable.map((profile) => <option key={`${profile.profileId}@${profile.version}`}
              value={`${profile.profileId}@${profile.version}`}>{profile.name} · {profile.version}{profile.active ? " · active" : ""}</option>)}</select>
          </label>
          {impactDefinition?.fields.filter(({ required }) => required).map((field) =>
            <label key={field.key} className="grid gap-2 text-sm font-medium">Migration default · {field.label}
              <Input value={migrationDefaults[field.key] ?? ""} onChange={(event) => {
                setMigrationDefaults((current) => ({ ...current, [field.key]: event.target.value }));
                setImpact(null);
              }} aria-describedby={`default-help-${field.key}`} />
              <span id={`default-help-${field.key}`} className="text-xs font-normal text-muted-foreground">Typed as {field.type}; leave blank when existing published records already have a value.</span>
            </label>)}
          {Object.entries(mappings).map(([fieldKey, mapping]) => <fieldset key={fieldKey}
            className="grid gap-3 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">Breaking field · {fieldKey}</legend>
            <label className="grid gap-2 text-sm">Mapping action<select className={inputClass} value={mapping.action}
              onChange={(event) => { setMappings((current) => ({ ...current, [fieldKey]: {
                ...mapping, action: event.target.value as MappingDraft["action"] } })); setImpact(null); }}>
              <option value="archive">Archive retained values</option><option value="map">Map to target field</option>
            </select></label>
            {mapping.action === "map" && <><label className="grid gap-2 text-sm">Target field key
              <Input value={mapping.to} onChange={(event) => { setMappings((current) => ({ ...current,
                [fieldKey]: { ...mapping, to: event.target.value } })); setImpact(null); }} /></label>
              <label className="grid gap-2 text-sm">Invalid values<select className={inputClass} value={mapping.onInvalid}
                onChange={(event) => { setMappings((current) => ({ ...current, [fieldKey]: {
                  ...mapping, onInvalid: event.target.value as MappingDraft["onInvalid"] } })); setImpact(null); }}>
                <option value="reject">Reject the whole migration</option><option value="archive">Archive invalid values</option>
              </select></label></>}
          </fieldset>)}
          <div className="flex flex-wrap items-center gap-3"><Button type="button" onClick={analyze}>Analyze impact</Button>
            <Button type="button" variant="outline" disabled={!impact} onClick={activate}>Activate reviewed version</Button>
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{status}</p></div>
          {impact && <section className="rounded-lg border p-4" aria-label="Profile impact report">
            <p className="font-medium">{impact.compatible ? "Compatible change" : "Explicit migration required"}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted-foreground">Listings</dt><dd>{impact.affectedListings}</dd></div>
              <div><dt className="text-muted-foreground">Value rows</dt><dd>{impact.affectedValues}</dd></div>
              <div><dt className="text-muted-foreground">Missing required</dt><dd>{impact.publishedMissingRequired}</dd></div>
              <div><dt className="text-muted-foreground">Invalid samples</dt><dd>{impact.invalidSamples.length}</dd></div>
            </dl>
            {impact.breakingFields.length > 0 && <p className="mt-3 break-words text-sm">Breaking fields: {impact.breakingFields.join(", ")}</p>}
          </section>}
        </div> : <p className="mt-4 text-sm text-muted-foreground">No packaged or stored base profile is available yet.</p>}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Site-owned fields</CardTitle></CardHeader><CardContent>
        {site?.fields.length ? <ul className="mb-6 grid gap-3">{site.fields.map((field) => <li key={field.key}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span><strong>{field.label}</strong><span className="ml-2 text-muted-foreground">{field.key} · {field.type}</span></span>
          <Button type="button" variant="destructive" size="sm" onClick={() => archiveField(field.key)}>Archive field</Button>
        </li>)}</ul> : <p className="mb-6 text-sm text-muted-foreground">No site-owned fields are active.</p>}
        <form onSubmit={saveField} className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">Field key<Input required value={draft.key}
              onChange={(event) => setDraft({ ...draft, key: event.target.value })} /></label>
            <label className="grid gap-2 text-sm font-medium">Label<Input required value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          </div>
          <label className="grid gap-2 text-sm font-medium">Help text<Input required value={draft.help}
            onChange={(event) => setDraft({ ...draft, help: event.target.value })} /></label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium">Field type<select className={inputClass} value={draft.type}
              onChange={(event) => setDraft({ ...draft, type: event.target.value as ProfileFieldType,
                cardinality: ["multiple-choice", "group"].includes(event.target.value) ? "many" : draft.cardinality })}>
              {fieldTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
            <label className="grid gap-2 text-sm font-medium">Cardinality<select className={inputClass} value={draft.cardinality}
              disabled={["multiple-choice", "group"].includes(draft.type)} onChange={(event) => setDraft({ ...draft,
                cardinality: event.target.value as "one" | "many" })}><option value="one">One value</option><option value="many">Repeatable values</option></select></label>
            <label className="flex items-center gap-2 pt-7 text-sm font-medium"><input type="checkbox" checked={draft.required}
              onChange={(event) => setDraft({ ...draft, required: event.target.checked })} />Required</label>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium">Write authority<select className={inputClass} value={draft.writeAuthority}
              onChange={(event) => setDraft({ ...draft, writeAuthority: event.target.value as FieldDraft["writeAuthority"] })}>
              <option value="operator">Operator</option><option value="owner">Owner</option><option value="system">System</option></select></label>
            <label className="grid gap-2 text-sm font-medium">Visibility<select className={inputClass} value={draft.visibility}
              onChange={(event) => setDraft({ ...draft, visibility: event.target.value as FieldDraft["visibility"] })}>
              <option value="public">Public</option><option value="staff">Staff</option><option value="private">Private</option></select></label>
            <label className="grid gap-2 text-sm font-medium">Display placement<select className={inputClass} value={draft.placement}
              onChange={(event) => setDraft({ ...draft, placement: event.target.value as FieldDraft["placement"] })}>
              <option value="card">Card</option><option value="badge">Badge</option><option value="detail">Detail</option><option value="hidden">Hidden</option></select></label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Display group<Input value={draft.group}
            onChange={(event) => setDraft({ ...draft, group: event.target.value })} /></label>
          <label className="grid gap-2 text-sm font-medium">Display order<Input type="number" value={draft.order}
            onChange={(event) => setDraft({ ...draft, order: event.target.value })} /></label></div>
          <fieldset className="grid gap-4 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">Type constraints</legend>
            {!(["boolean", "url", "single-choice", "multiple-choice", "location"].includes(draft.type)) && <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">Minimum<Input value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} /></label>
              <label className="grid gap-2 text-sm">Maximum<Input value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} /></label>
            </div>}
            {draft.type === "decimal" && <label className="grid gap-2 text-sm">Decimal scale<Input type="number" value={draft.scale} onChange={(event) => setDraft({ ...draft, scale: event.target.value })} /></label>}
            {["money", "location"].includes(draft.type) && <label className="grid gap-2 text-sm">{draft.type === "money" ? "Allowed currencies (comma separated)" : "Allowed country codes (comma separated)"}<Input value={draft.options} onChange={(event) => setDraft({ ...draft, options: event.target.value })} /></label>}
            {["single-choice", "multiple-choice"].includes(draft.type) && <label className="grid gap-2 text-sm">Choices, one value|Label per line<textarea className="min-h-28 rounded-lg border border-input bg-background p-3 text-sm" value={draft.options} onChange={(event) => setDraft({ ...draft, options: event.target.value })} /></label>}
            {draft.type === "group" && <div className="grid gap-3"><div className="flex items-center justify-between"><p className="text-sm font-medium">Group child fields</p><Button type="button" variant="outline" size="sm" onClick={() => setDraft({ ...draft, children: [...draft.children, blankChild()] })}>Add child</Button></div>
              {draft.children.map((child, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                {(["key", "label", "help"] as const).map((key) => <label key={key} className="grid gap-1 text-xs font-medium">{key}<Input value={child[key]} onChange={(event) => setDraft({ ...draft,
                  children: draft.children.map((entry, at) => at === index ? { ...entry, [key]: event.target.value } : entry) })} /></label>)}
                <label className="grid gap-1 text-xs font-medium">Type<select className={inputClass} value={child.type} onChange={(event) => setDraft({ ...draft,
                  children: draft.children.map((entry, at) => at === index ? { ...entry, type: event.target.value as ChildDraft["type"] } : entry) })}>{fieldTypes.filter((type) => type !== "group").map((type) => <option key={type}>{type}</option>)}</select></label>
                <label className="grid gap-1 text-xs font-medium">Minimum<Input value={child.min} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, at) => at === index ? { ...entry, min: event.target.value } : entry) })} /></label>
                <label className="grid gap-1 text-xs font-medium">Maximum<Input value={child.max} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, at) => at === index ? { ...entry, max: event.target.value } : entry) })} /></label>
                <label className="grid gap-1 text-xs font-medium">Choices / currencies / countries<Input value={child.options} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, at) => at === index ? { ...entry, options: event.target.value } : entry) })} /></label>
                <div className="flex items-end justify-between gap-3"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={child.required} onChange={(event) => setDraft({ ...draft, children: draft.children.map((entry, at) => at === index ? { ...entry, required: event.target.checked } : entry) })} />Required child</label><Button type="button" variant="destructive" size="sm" onClick={() => setDraft({ ...draft, children: draft.children.filter((_, at) => at !== index) })}>Remove</Button></div>
              </div>)}</div>}
          </fieldset>
          <fieldset className="grid gap-4 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">Discovery settings</legend>
            <div className="flex flex-wrap gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={draft.searchable} disabled={!(["short-text", "markdown"].includes(draft.type)) || draft.visibility !== "public"} onChange={(event) => setDraft({ ...draft, searchable: event.target.checked })} />Searchable</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.facet} disabled={!facetTypes.has(draft.type) || draft.visibility !== "public"} onChange={(event) => setDraft({ ...draft, facet: event.target.checked })} />Facet</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.sort} disabled={!sortTypes.has(draft.type) || draft.cardinality !== "one" || draft.visibility !== "public"} onChange={(event) => setDraft({ ...draft, sort: event.target.checked })} />Sort choice</label></div>
            {draft.facet && <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">Facet label<Input value={draft.facetLabel} onChange={(event) => setDraft({ ...draft, facetLabel: event.target.value })} /></label><label className="grid gap-2 text-sm">Facet match<select className={inputClass} value={draft.facetMode} onChange={(event) => setDraft({ ...draft, facetMode: event.target.value as "any" | "all" })}><option value="any">Any selected value</option><option value="all">All selected values</option></select></label></div>}
            {draft.sort && <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm">Sort label<Input value={draft.sortLabel} onChange={(event) => setDraft({ ...draft, sortLabel: event.target.value })} /></label><label className="grid gap-2 text-sm">Directions<select className={inputClass} value={draft.directions} onChange={(event) => setDraft({ ...draft, directions: event.target.value as FieldDraft["directions"] })}><option value="both">Ascending and descending</option><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div>}
          </fieldset>
          <label className="grid gap-2 text-sm font-medium">Typed default<Input value={draft.defaultValue} onChange={(event) => setDraft({ ...draft, defaultValue: event.target.value })} /><span className="text-xs font-normal text-muted-foreground">Use the selected type’s format. Leave blank for no default.</span></label>
          <div className="flex flex-wrap items-center gap-3"><Button type="submit">Save site field</Button><p role="status" aria-live="polite" className="text-sm text-muted-foreground">{fieldStatus}</p></div>
        </form>
      </CardContent></Card>

      <Card><CardHeader><CardTitle>Permanent archived-value purge</CardTitle></CardHeader><CardContent>
        <p className="text-sm text-muted-foreground">Inspect the exact current count, then type that count to authorize one audited deletion.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Profile ID<Input value={purgeProfile} onChange={(event) => { setPurgeProfile(event.target.value); setPurgeImpact(null); }} /></label><label className="grid gap-2 text-sm font-medium">Archived field key<Input value={purgeField} onChange={(event) => { setPurgeField(event.target.value); setPurgeImpact(null); }} /></label></div>
        <div className="mt-4 flex flex-wrap items-end gap-3"><Button type="button" variant="outline" onClick={inspectPurge}>Inspect purge impact</Button>{purgeImpact !== null && <label className="grid gap-2 text-sm font-medium">Type {purgeImpact} to confirm<Input inputMode="numeric" value={purgeConfirmation} onChange={(event) => setPurgeConfirmation(event.target.value)} /></label>}<Button type="button" variant="destructive" disabled={purgeImpact === null || purgeImpact < 1 || purgeConfirmation.trim() !== String(purgeImpact)} onClick={purge}>Permanently purge</Button></div>
        <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">{purgeStatus}</p>
      </CardContent></Card>
    </div>
  );
}
