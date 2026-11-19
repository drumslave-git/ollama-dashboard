import { useEffect, useState } from "react";

type Theme = "auto" | "light" | "dark";

/** Same key as the pre-paint script in index.html. */
const STORAGE_KEY = "ollama-dashboard:theme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "auto";
}

/** No attribute means Auto: CSS then follows prefers-color-scheme. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = theme === "auto" ? "light dark" : theme;
}

function systemScheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Auto / Light / Dark for the page; the choice is kept in localStorage. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [system, setSystem] = useState(systemScheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystem = () => setSystem(systemScheme());
    // Another tab changed the choice.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next: Theme = e.newValue === "light" || e.newValue === "dark" ? e.newValue : "auto";
      applyTheme(next);
      setTheme(next);
    };
    media.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const choose = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
    try {
      if (next === "auto") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the theme still applies for this visit.
    }
  };

  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={theme === o.value}
          title={
            o.value === "auto" ? `Follow the system setting (now ${system})` : undefined
          }
          onClick={() => choose(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
