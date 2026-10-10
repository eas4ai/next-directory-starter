import { PresetExternalLinkIcon } from "@/components/preset-icon";

type Props = {
  library: string;
  mode: string;
  styleName: string;
  scope: "preset" | "selection";
  templateId?: string;
};

export function ThemePreview({ library, mode, styleName, scope, templateId }: Props) {
  return (
    <section className={`${scope}-preview theme-preview overflow-hidden rounded-xl border`}
      data-mode={mode} data-template={templateId} aria-label={scope === "preset" ? "Theme preview" : "Template preview"}>
      <div className="theme-preview-body space-y-6 p-6">
        <div className="theme-preview-heading-block">
          <p className="theme-preview-muted text-xs uppercase tracking-widest">Live preview · {styleName}</p>
          <h2 className="theme-preview-heading mt-2 text-2xl font-semibold">Find something useful</h2>
          <p className="theme-preview-muted mt-2 text-sm">A sample directory card in your selected palette and type.</p>
        </div>
        <div className="theme-preview-card rounded-lg border">
          <p className="text-sm font-semibold">Example Tool</p>
          <p className="theme-preview-muted mt-1 text-sm">A sample link for your directory</p>
          <div className="mt-4 flex items-center gap-3">
            <span className="theme-preview-primary inline-flex items-center gap-2 px-4 text-sm font-medium">
              Visit listing <PresetExternalLinkIcon library={library} />
            </span>
            <span className="theme-preview-muted text-xs">{library} icons</span>
          </div>
        </div>
        <div className="flex gap-1" aria-label="Chart colors">
          {[1, 2, 3, 4, 5].map((index) =>
            <span key={index} className={`theme-preview-chart theme-preview-chart-${index} h-6 flex-1 rounded-sm`} />)}
        </div>
        <div className="theme-preview-menu rounded-lg border px-4 py-3 text-sm">
          <span className="theme-preview-menu-accent rounded px-2 py-1">Menu preview</span>
        </div>
      </div>
    </section>
  );
}
