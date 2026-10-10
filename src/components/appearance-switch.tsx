"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

export function AppearanceSwitch({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState(initialMode);
  const [systemDark, setSystemDark] = useState<boolean | null>(null);

  useEffect(() => {
    if (mode !== "system") return;
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, [mode]);

  const effectiveDark = mode === "system" ? systemDark : mode === "dark";

  function toggle() {
    const currentlyDark = effectiveDark ?? window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = currentlyDark ? "light" : "dark";
    document.documentElement.dataset.mode = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = `site_appearance=${next}; Path=/; Max-Age=31536000; SameSite=Lax${
      location.protocol === "https:" ? "; Secure" : ""}`;
    setMode(next);
  }

  return (
    <button type="button" aria-label="Appearance" aria-pressed={mode === "dark"}
      title={effectiveDark === null ? "Change appearance" :
        `Switch to ${effectiveDark ? "light" : "dark"} appearance`}
      onClick={toggle}
      className="min-h-10 rounded-md border border-sidebar-border px-3 py-2 text-sm text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring">
      {effectiveDark === null ? "System" : effectiveDark ? "Dark" : "Light"}
    </button>
  );
}
