"use client";

import { useEffect, useState } from "react";

/** Resolve CSS custom properties to concrete colors (SVG attributes can't use var()) and track theme changes. */
export function useCssVars<T extends string>(names: readonly T[]): Record<T, string> {
  const read = () => {
    const out = {} as Record<T, string>;
    const cs = getComputedStyle(document.documentElement);
    for (const n of names) out[n] = cs.getPropertyValue(n).trim() || "#888";
    return out;
  };
  // Start from the fallback on both server and client so hydration matches, then resolve after mount.
  const [vars, setVars] = useState<Record<T, string>>(() => {
    const out = {} as Record<T, string>;
    for (const n of names) out[n] = "#888";
    return out;
  });
  useEffect(() => {
    setVars(read());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setVars(read());
    mq.addEventListener("change", update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      obs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return vars;
}
