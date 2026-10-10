"use client";

import { useState } from "react";

type Mode = "light" | "dark" | "system";

export function AppearanceSwitch({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState(initialMode);

  function toggle() {
    const currentlyDark = mode === "dark" ||
      (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = currentlyDark ? "light" : "dark";
    document.documentElement.dataset.mode = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    document.cookie = `site_appearance=${next}; Path=/; Max-Age=31536000; SameSite=Lax${
      location.protocol === "https:" ? "; Secure" : ""}`;
    setMode(next);
  }

  return (
    <button type="button" aria-label="Appearance" aria-pressed={mode === "dark"}
      title={`Switch to ${mode === "dark" ? "light" : "dark"} appearance`}
      onClick={toggle}
      className="min-h-10 rounded-md border border-sidebar-border px-3 py-2 text-sm text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring">
      {mode === "system" ? "System" : mode === "dark" ? "Dark" : "Light"}
    </button>
  );
}
