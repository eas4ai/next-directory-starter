import { Fragment, type ReactNode } from "react";
import { ContentImage } from "@/components/content-image";
import { MarkdownContent } from "@/components/markdown-content";
import type {
  DirectoryProfileField, ProfileChildField, ProfileDateRange, ProfileGroupItem,
  ProfileLocation, ProfileMoney, ProfileRepeatedValue, ProfileValueSet,
} from "@/lib/directory-profile-types";
import { publicMediaAsset, type MediaAsset } from "@/lib/media";

type ScalarField = DirectoryProfileField | ProfileChildField;
type Placement = DirectoryProfileField["placement"];

function choiceLabel(field: ScalarField, value: string): string {
  const options = Array.isArray(field.constraints.choices)
    ? field.constraints.choices as { value: string; label: string }[] : [];
  return options.find((choice) => choice.value === value)?.label ?? value;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

function money(value: unknown): { machine: string; display: string } | null {
  if (!value || typeof value !== "object") return null;
  const { amountMinor, currency } = value as Partial<ProfileMoney>;
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) ||
      typeof currency !== "string") return null;
  try {
    return { machine: `${currency}:${amountMinor}`,
      display: new Intl.NumberFormat("en-US", { style: "currency", currency })
        .format(amountMinor / 100) };
  } catch {
    return null;
  }
}

function duration(seconds: unknown): string {
  if (!Number.isSafeInteger(seconds) || (seconds as number) < 0) return "";
  const units = [[86_400, "day"], [3_600, "hour"], [60, "minute"], [1, "second"]] as const;
  let remaining = seconds as number;
  const parts: string[] = [];
  for (const [size, label] of units) {
    const count = Math.floor(remaining / size);
    if (!count) continue;
    parts.push(`${count} ${label}${count === 1 ? "" : "s"}`);
    remaining %= size;
    if (parts.length === 2) break;
  }
  return parts.join(" ") || "0 seconds";
}

function dateLabel(value: string, includesTime = false): string {
  const parsed = new Date(includesTime ? value : `${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", includesTime
    ? { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }
    : { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
}

function location(value: unknown): { machine: string; display: string } | null {
  if (!value || typeof value !== "object") return null;
  const place = value as Partial<ProfileLocation>;
  if (typeof place.countryCode !== "string") return null;
  const machine = place.locality !== undefined
    ? `${place.countryCode}|${place.region ?? ""}|${place.locality}`
    : place.region === undefined ? place.countryCode : `${place.countryCode}|${place.region}`;
  return { machine, display: [place.locality, place.region, place.countryCode].filter(Boolean).join(", ") };
}

function MediaValue({ value, mediaAssets }: { value: unknown;
  mediaAssets?: ReadonlyMap<string, MediaAsset> }) {
  if (typeof value !== "string") return null;
  const asset = mediaAssets ? mediaAssets.get(value) : publicMediaAsset(value);
  return asset ? <ContentImage asset={asset} /> : null;
}

function textValue(field: ScalarField, value: unknown): ReactNode {
  switch (field.type) {
    case "short-text":
      return typeof value === "string" ? value : null;
    case "markdown":
      return typeof value === "string" ? <MarkdownContent source={value} /> : null;
    case "url": { const href = safeUrl(value); return href
      ? <a href={href} target="_blank" rel="noopener noreferrer" className="wrap-anywhere underline underline-offset-2">{href}</a>
      : null; }
    default:
      return null;
  }
}

function numericValue(field: ScalarField, value: unknown): ReactNode {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? value ? "Yes" : "No" : null;
    case "integer":
      return typeof value === "number" ? <span data-value={String(value)}>{value}</span> : null;
    case "decimal":
      return typeof value === "string" ? <span data-value={value}>{value}</span> : null;
    case "money": { const formatted = money(value); return formatted
      ? <span data-value={formatted.machine}>{formatted.display}</span> : null; }
    default:
      return null;
  }
}

function choiceValue(field: ScalarField, value: unknown): ReactNode {
  if (field.type === "single-choice") {
    return typeof value === "string" ? choiceLabel(field, value) : null;
  }
  if (field.type !== "multiple-choice" || !Array.isArray(value)) return null;
  return <span className="profile-choice-list">{value.map((item, index) =>
    typeof item === "string" ? <Fragment key={item}>{index > 0 && ", "}{choiceLabel(field, item)}</Fragment>
      : null)}</span>;
}

function temporalValue(field: ScalarField, value: unknown): ReactNode {
  switch (field.type) {
    case "date":
      return typeof value === "string" ? <time dateTime={value}>{dateLabel(value)}</time> : null;
    case "datetime":
      return typeof value === "string" ? <time dateTime={value}>{dateLabel(value, true)}</time> : null;
    case "date-range": { const range = value as Partial<ProfileDateRange>; return range.start && range.end
      ? <span data-start={range.start} data-end={range.end}>
        <time dateTime={range.start}>{dateLabel(range.start)}</time>
        {" – "}<time dateTime={range.end}>{dateLabel(range.end)}</time>
      </span> : null; }
    case "duration":
      return typeof value === "number"
        ? <span data-seconds={String(value)}>{duration(value)}</span> : null;
    default:
      return null;
  }
}

function scalarValue(field: ScalarField, value: unknown,
  mediaAssets?: ReadonlyMap<string, MediaAsset>): ReactNode {
  if (value === null || value === undefined) return null;
  if (["short-text", "markdown", "url"].includes(field.type)) return textValue(field, value);
  if (["boolean", "integer", "decimal", "money"].includes(field.type)) {
    return numericValue(field, value);
  }
  if (["single-choice", "multiple-choice"].includes(field.type)) return choiceValue(field, value);
  if (["date", "datetime", "date-range", "duration"].includes(field.type)) {
    return temporalValue(field, value);
  }
  if (field.type === "location") {
    const formatted = location(value);
    return formatted ? <span data-location={formatted.machine}>{formatted.display}</span> : null;
  }
  return field.type === "media" ? <MediaValue value={value} mediaAssets={mediaAssets} /> : null;
}

function repeatedValue(field: DirectoryProfileField, value: unknown,
  mediaAssets?: ReadonlyMap<string, MediaAsset>): ReactNode {
  if (field.type === "multiple-choice") return scalarValue(field, value, mediaAssets);
  if (!Array.isArray(value)) return null;
  return <ul className="profile-repeat-list">{(value as ProfileRepeatedValue[]).map((item) =>
    <li key={item.id}>{scalarValue(field, item.value, mediaAssets)}</li>)}</ul>;
}

function GroupValue({ field, value, mediaAssets }: { field: DirectoryProfileField; value: unknown;
  mediaAssets?: ReadonlyMap<string, MediaAsset> }) {
  if (!Array.isArray(value)) return null;
  const children = field.constraints.children as ProfileChildField[];
  return <ul className="profile-group-list">{(value as ProfileGroupItem[]).map((item) =>
    <li key={item.id} className="profile-group-item">
      <dl>{children.filter((child) => item.values[child.key] !== undefined).map((child) =>
        <div key={child.key} className="profile-group-pair">
          <dt>{child.label}</dt>
          <dd>{scalarValue(child, item.values[child.key], mediaAssets)}</dd>
        </div>)}</dl>
    </li>)}</ul>;
}

function fieldValue(field: DirectoryProfileField, value: unknown,
  mediaAssets?: ReadonlyMap<string, MediaAsset>): ReactNode {
  if (field.type === "group") {
    return <GroupValue field={field} value={value} mediaAssets={mediaAssets} />;
  }
  return field.cardinality === "many"
    ? repeatedValue(field, value, mediaAssets) : scalarValue(field, value, mediaAssets);
}

function visible(field: DirectoryProfileField, values: ProfileValueSet, mode: "public" | "staff",
  placements?: Placement[]): boolean {
  if (!Object.hasOwn(values, field.key)) return false;
  if (mode === "public" && (field.visibility !== "public" || field.placement === "hidden")) return false;
  return !placements || placements.includes(field.placement);
}

export function ProfileValuesView({ fields, values, mode = "public", placements, mediaAssets }: {
  fields: DirectoryProfileField[];
  values: ProfileValueSet;
  mode?: "public" | "staff";
  placements?: Placement[];
  mediaAssets?: ReadonlyMap<string, MediaAsset>;
}) {
  const entries = fields.filter((field) => visible(field, values, mode, placements));
  if (!entries.length) return null;
  return <dl className="profile-values">
    {entries.map((field) => <div key={field.key} className="profile-value"
      data-profile-placement={field.placement} data-profile-field={field.key}>
      <dt>{field.label}</dt>
      <dd>{fieldValue(field, values[field.key], mediaAssets)}</dd>
    </div>)}
  </dl>;
}
