"use client";

import { Button } from "@/components/ui/button";
import { ImageUploader } from "@/components/image-uploader";
import { Input } from "@/components/ui/input";
import type {
  DirectoryProfileField, ProfileChildField, ProfileGroupItem, ProfileMoney,
  ProfileRepeatedValue, ProfileValueSet,
} from "@/lib/directory-profile-types";

type Authority = "operator" | "owner";
type FieldLike = DirectoryProfileField | ProfileChildField;
type Change = (value: unknown) => void;

const inputClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const areaClass = "min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function idPart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-");
}

function numberConstraint(field: FieldLike, key: string): number | undefined {
  const value = field.constraints[key];
  return typeof value === "number" ? value : undefined;
}

function stringConstraint(field: FieldLike, key: string): string | undefined {
  const value = field.constraints[key];
  return typeof value === "string" ? value : undefined;
}

function choiceConstraints(field: FieldLike): { value: string; label: string }[] {
  return Array.isArray(field.constraints.choices)
    ? field.constraints.choices as { value: string; label: string }[] : [];
}

function nextItemId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}`;
}

function atomicControl(field: FieldLike, value: unknown, onChange: Change, inputId: string,
  describedBy: string, mediaEndpoint: string, itemId = "value", profileFieldKey = field.key) {
  const common = { id: inputId, "aria-describedby": describedBy };
  if (field.type === "short-text") return <Input {...common} type="text"
    required={field.required} minLength={numberConstraint(field, "minLength")}
    maxLength={numberConstraint(field, "maxLength")}
    value={typeof value === "string" ? value : ""}
    onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "markdown") return <textarea {...common} className={areaClass}
    required={field.required} minLength={numberConstraint(field, "minLength")}
    maxLength={numberConstraint(field, "maxLength")}
    value={typeof value === "string" ? value : ""}
    onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "boolean") return <Input {...common} type="checkbox"
    checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
  if (field.type === "integer") return <Input {...common} type="number" step={1}
    required={field.required} min={numberConstraint(field, "min")} max={numberConstraint(field, "max")}
    value={typeof value === "number" ? value : ""}
    onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />;
  if (field.type === "decimal") {
    const scale = numberConstraint(field, "scale") ?? 0;
    return <Input {...common} type="number" required={field.required}
      step={scale ? `0.${"0".repeat(Math.max(0, scale - 1))}1` : "1"}
      min={stringConstraint(field, "min")} max={stringConstraint(field, "max")}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value || undefined)} />;
  }
  if (field.type === "money") {
    const money = value && typeof value === "object" ? value as Partial<ProfileMoney> : {};
    const currencies = Array.isArray(field.constraints.currencies)
      ? field.constraints.currencies as string[] : [];
    return <fieldset className="grid gap-3 rounded-md border p-3" aria-describedby={describedBy}>
      <legend className="px-1 text-sm font-medium">{field.label} value</legend>
      <label className="grid gap-1 text-sm" htmlFor={`${inputId}-amount`}>Amount in minor units</label>
      <Input id={`${inputId}-amount`} type="number" step={1} required={field.required}
        min={numberConstraint(field, "minMinor")} max={numberConstraint(field, "maxMinor")}
        value={typeof money.amountMinor === "number" ? money.amountMinor : ""}
        onChange={(event) => onChange({ ...money,
          amountMinor: event.target.value === "" ? undefined : Number(event.target.value) })} />
      <label className="grid gap-1 text-sm" htmlFor={`${inputId}-currency`}>Currency</label>
      <select id={`${inputId}-currency`} className={inputClass} required={field.required}
        value={typeof money.currency === "string" ? money.currency : ""}
        onChange={(event) => onChange({ ...money, currency: event.target.value })}>
        <option value="">Choose currency</option>
        {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
      </select>
    </fieldset>;
  }
  if (field.type === "single-choice") return <select {...common} className={inputClass}
    required={field.required} value={typeof value === "string" ? value : ""}
    onChange={(event) => onChange(event.target.value || undefined)}>
    <option value="">Choose {field.label.toLowerCase()}</option>
    {choiceConstraints(field).map((choice) => <option key={choice.value} value={choice.value}>
      {choice.label}
    </option>)}
  </select>;
  if (field.type === "multiple-choice") {
    const selected = new Set(Array.isArray(value) ? value as string[] : []);
    return <fieldset className="grid gap-2 rounded-md border p-3" aria-describedby={describedBy}>
      <legend className="px-1 text-sm font-medium">{field.label} choices</legend>
      {choiceConstraints(field).map((choice) => <label key={choice.value} className="flex gap-2 text-sm">
        <Input type="checkbox" checked={selected.has(choice.value)}
          onChange={(event) => onChange(choiceConstraints(field).map(({ value: option }) => option)
            .filter((option) => option === choice.value ? event.target.checked : selected.has(option)))} />
        {choice.label}
      </label>)}
    </fieldset>;
  }
  if (field.type === "url") return <Input {...common} type="url" required={field.required}
    maxLength={2048} value={typeof value === "string" ? value : ""}
    onChange={(event) => onChange(event.target.value || undefined)} />;
  if (field.type === "date") return <Input {...common} type="date" required={field.required}
    min={stringConstraint(field, "min")} max={stringConstraint(field, "max")}
    value={typeof value === "string" ? value : ""}
    onChange={(event) => onChange(event.target.value || undefined)} />;
  if (field.type === "datetime") return <Input {...common} type="datetime-local" required={field.required}
    value={typeof value === "string" ? value.replace(/:00\.000Z$/, "") : ""}
    onChange={(event) => onChange(event.target.value ? new Date(event.target.value).toISOString() : undefined)} />;
  if (field.type === "date-range") {
    const range = value && typeof value === "object" ? value as { start?: string; end?: string } : {};
    return <fieldset className="grid gap-3 rounded-md border p-3" aria-describedby={describedBy}>
      <legend className="px-1 text-sm font-medium">{field.label} dates</legend>
      <label htmlFor={`${inputId}-start`} className="text-sm">Start</label>
      <Input id={`${inputId}-start`} type="date" required={field.required}
        min={stringConstraint(field, "min")} max={stringConstraint(field, "max")}
        value={range.start ?? ""} onChange={(event) => onChange({ ...range, start: event.target.value })} />
      <label htmlFor={`${inputId}-end`} className="text-sm">End</label>
      <Input id={`${inputId}-end`} type="date" required={field.required}
        min={stringConstraint(field, "min")} max={stringConstraint(field, "max")}
        value={range.end ?? ""} onChange={(event) => onChange({ ...range, end: event.target.value })} />
    </fieldset>;
  }
  if (field.type === "duration") return <fieldset className="grid gap-3 rounded-md border p-3"
    aria-describedby={describedBy}>
    <legend className="px-1 text-sm font-medium">{field.label} duration</legend>
    <label htmlFor={`${inputId}-amount`} className="text-sm">Amount</label>
    <Input id={`${inputId}-amount`} type="number" step={1} required={field.required}
      min={numberConstraint(field, "minSeconds")} max={numberConstraint(field, "maxSeconds")}
      value={typeof value === "number" ? value : ""}
      onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />
    <label htmlFor={`${inputId}-unit`} className="text-sm">Unit</label>
    <select id={`${inputId}-unit`} className={inputClass} value="seconds"
      aria-readonly="true" onChange={() => undefined}>
      <option value="seconds">Seconds</option>
    </select>
  </fieldset>;
  if (field.type === "location") {
    const location = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const countries = Array.isArray(field.constraints.countries)
      ? field.constraints.countries as string[] : [];
    const update = (key: string, next: unknown) => onChange({ ...location, [key]: next });
    return <fieldset className="grid gap-3 rounded-md border p-3" aria-describedby={describedBy}>
      <legend className="px-1 text-sm font-medium">{field.label} location</legend>
      <label htmlFor={`${inputId}-country`} className="text-sm">Country</label>
      <select id={`${inputId}-country`} className={inputClass} required={field.required}
        value={typeof location.countryCode === "string" ? location.countryCode : ""}
        onChange={(event) => update("countryCode", event.target.value)}>
        <option value="">Choose country</option>
        {countries.map((country) => <option key={country} value={country}>{country}</option>)}
      </select>
      {(["region", "locality"] as const).map((key) => <label key={key} className="grid gap-1 text-sm">
        {key === "region" ? "Region" : "Locality"}
        <Input value={typeof location[key] === "string" ? location[key] as string : ""}
          maxLength={120} onChange={(event) => update(key, event.target.value || undefined)} />
      </label>)}
      {(["latitude", "longitude"] as const).map((key) => <label key={key} className="grid gap-1 text-sm">
        {key === "latitude" ? "Latitude" : "Longitude"}
        <Input type="number" step="0.000001" min={key === "latitude" ? -90 : -180}
          max={key === "latitude" ? 90 : 180}
          value={typeof location[key] === "number" ? location[key] as number : ""}
          onChange={(event) => update(key, event.target.value === "" ? undefined : Number(event.target.value))} />
      </label>)}
    </fieldset>;
  }
  if (field.type === "media") {
    const endpoint = `${mediaEndpoint}?fieldKey=${encodeURIComponent(profileFieldKey)}&itemId=${encodeURIComponent(itemId)}`;
    return <div aria-describedby={describedBy}>
      <ImageUploader endpoint={endpoint} label={field.label}
        onAsset={(asset) => onChange(asset.id)} />
      {typeof value === "string" && <p className="mt-2 text-xs text-muted-foreground">
        Selected media: {value}
      </p>}
    </div>;
  }
  return null;
}

function allowed(authority: Authority, field: DirectoryProfileField): boolean {
  return authority === "operator" ? field.writeAuthority !== "system" : field.writeAuthority === "owner";
}

export function ProfileFieldEditor({ fields, values, authority, mediaEndpoint, errors, onChange }: {
  fields: DirectoryProfileField[];
  values: ProfileValueSet;
  authority: Authority;
  mediaEndpoint: string;
  errors: Record<string, string>;
  onChange: (values: ProfileValueSet) => void;
}) {
  const setField = (fieldKey: string, value: unknown) => {
    const next = { ...values };
    if (value === undefined) delete next[fieldKey];
    else next[fieldKey] = value;
    onChange(next);
  };
  return <div className="grid gap-5">
    {fields.filter((field) => allowed(authority, field)).map((field) => {
      const baseId = `profile-${idPart(field.key)}`;
      const helpId = `${baseId}-help`;
      const errorId = `${baseId}-error`;
      const describedBy = errors[field.key] ? `${helpId} ${errorId}` : helpId;
      const current = values[field.key] ?? field.default;
      if (field.type === "group") {
        const items = Array.isArray(current) ? current as ProfileGroupItem[] : [];
        const children = field.constraints.children as ProfileChildField[];
        const noun = field.label.replace(/s$/i, "").toLowerCase();
        return <fieldset key={field.key} className="grid gap-4 rounded-md border p-4"
          aria-describedby={describedBy}>
          <legend className="px-1 text-sm font-semibold">{field.label}</legend>
          <p id={helpId} className="text-xs text-muted-foreground">{field.help}</p>
          {items.map((item, index) => <fieldset key={item.id} className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{field.label} {index + 1}</legend>
            {children.map((child) => {
              const childId = `${baseId}-${idPart(item.id)}-${idPart(child.key)}`;
              const childHelp = `${childId}-help`;
              return <div key={child.key} className="grid gap-2">
                <label htmlFor={childId} className="text-sm font-medium">{child.label}</label>
                <p id={childHelp} className="text-xs text-muted-foreground">{child.help}</p>
                {atomicControl(child, item.values[child.key], (value) => {
                  const next = items.map((candidate) => candidate.id === item.id
                    ? { ...candidate, values: { ...candidate.values, [child.key]: value } } : candidate);
                  setField(field.key, next);
                }, childId, childHelp, mediaEndpoint, item.id, field.key)}
              </div>;
            })}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" aria-label={`Move ${item.id} up`}
                disabled={index === 0} onClick={() => {
                  const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  setField(field.key, next);
                }}>Move up</Button>
              <Button type="button" variant="outline" aria-label={`Move ${item.id} down`}
                disabled={index === items.length - 1} onClick={() => {
                  const next = [...items]; [next[index], next[index + 1]] = [next[index + 1], next[index]];
                  setField(field.key, next);
                }}>Move down</Button>
              <Button type="button" variant="outline" aria-label={`Remove ${item.id}`}
                onClick={() => setField(field.key, items.filter(({ id }) => id !== item.id))}>Remove</Button>
            </div>
          </fieldset>)}
          <Button type="button" variant="outline" className="w-fit"
            disabled={items.length >= (numberConstraint(field, "maxItems") ?? 25)}
            onClick={() => setField(field.key, [...items, { id: nextItemId(), values: {} }])}>
            Add {noun}
          </Button>
          {errors[field.key] && <p id={errorId} role="alert" className="text-sm text-destructive">
            {errors[field.key]}
          </p>}
        </fieldset>;
      }
      if (field.cardinality === "many" && field.type !== "multiple-choice") {
        const items = Array.isArray(current) ? current as ProfileRepeatedValue[] : [];
        return <fieldset key={field.key} className="grid gap-3 rounded-md border p-4"
          aria-describedby={describedBy}>
          <legend className="px-1 text-sm font-semibold">{field.label}</legend>
          <p id={helpId} className="text-xs text-muted-foreground">{field.help}</p>
          {items.map((item, index) => <div key={item.id} className="grid gap-2 rounded-md border p-3">
            {atomicControl(field, item.value, (value) => setField(field.key,
              items.map((candidate) => candidate.id === item.id ? { ...candidate, value } : candidate)),
            `${baseId}-${idPart(item.id)}`, describedBy, mediaEndpoint, item.id, field.key)}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" aria-label={`Move ${item.id} up`}
                disabled={index === 0} onClick={() => {
                  const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  setField(field.key, next);
                }}>Move up</Button>
              <Button type="button" variant="outline" aria-label={`Remove ${item.id}`}
                onClick={() => setField(field.key, items.filter(({ id }) => id !== item.id))}>Remove</Button>
            </div>
          </div>)}
          <Button type="button" variant="outline" className="w-fit"
            disabled={items.length >= (field.type === "media"
              ? numberConstraint(field, "maxItems") ?? 25 : 25)}
            onClick={() => setField(field.key, [...items, { id: nextItemId(), value: undefined }])}>
            Add {field.label.replace(/s$/i, "").toLowerCase()}
          </Button>
          {errors[field.key] && <p id={errorId} role="alert" className="text-sm text-destructive">
            {errors[field.key]}
          </p>}
        </fieldset>;
      }
      return <div key={field.key} className="grid gap-2">
        <label htmlFor={baseId} className="text-sm font-medium">{field.label}</label>
        <p id={helpId} className="text-xs text-muted-foreground">{field.help}</p>
        {atomicControl(field, current, (value) => setField(field.key, value), baseId,
          describedBy, mediaEndpoint)}
        {errors[field.key] && <p id={errorId} role="alert" className="text-sm text-destructive">
          {errors[field.key]}
        </p>}
      </div>;
    })}
  </div>;
}
