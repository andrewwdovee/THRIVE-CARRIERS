import React, { useState } from "react";

/* The LeadTech mark.

   The real artwork lives in public/brand/. Drop a file in as `logo.svg` (or
   `logo.png`) and it is used everywhere the logo appears — header, sign-in,
   nothing else to change. Until one is there, the drawn fallback below
   stands in.

   Doing it this way round matters: a logo redrawn by hand from a screenshot
   is never quite the logo, and every place it appears inherits the error.
   The real file is the source of truth; the fallback only keeps the layout
   from collapsing while it is missing. */

const SOURCES = ["/brand/logo.svg", "/brand/logo.png"];

/* Stands in until the artwork is dropped in. Deliberately plain — it should
   look like a placeholder rather than pass for a logo nobody approved. */
function Fallback({ className }) {
  return (
    <svg viewBox="0 0 60 64" className={className} fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 4 h23 l-6.5 26 h-23 z" />
      <path d="M44 11 h11 l-4 16 h-11 z" />
      <path d="M9 34 h23 l-6.5 26 h-23 z" />
    </svg>
  );
}

export function Mark({ className = "h-9" }) {
  /* Walk the candidates on error rather than probing up front: a missing
     file costs one failed request, not a render blocked on a fetch. */
  const [i, setI] = useState(0);
  if (i >= SOURCES.length) return <Fallback className={className} />;
  return (
    <img src={SOURCES[i]} alt="" aria-hidden="true"
      className={`${className} w-auto object-contain`}
      onError={() => setI((n) => n + 1)} />
  );
}

/* Mark plus wordmark. If the artwork already includes the words — most logo
   files do — pass withWord={false} and let the file speak for itself. */
export default function Logo({ size = "md", className = "", withWord = true }) {
  const s = size === "lg"
    ? { mark: "h-14", word: "text-3xl", track: "0.3em" }
    : size === "sm"
      ? { mark: "h-7", word: "text-sm", track: "0.24em" }
      : { mark: "h-9", word: "text-xl", track: "0.28em" };

  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <Mark className={`${s.mark} shrink-0`} />
      {withWord && (
        <span className={`${s.word} font-semibold leading-none`} style={{ letterSpacing: s.track }}>
          LEADTECH
        </span>
      )}
    </span>
  );
}
