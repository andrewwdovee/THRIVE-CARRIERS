import React from "react";

/* The LeadTech mark: three parallelograms stepping down to the right, drawn
   as outlines the way the supplied artwork is.

   Everything is stroked in `currentColor` rather than a fixed white, so one
   file serves the dark header, the light one, and the sign-in screen without
   a second copy that drifts out of step. Set the colour on the parent.

   Recreated from the supplied image. To use the original artwork instead,
   drop it in public/ and swap <Mark/> for an <img>; nothing else changes. */

export function Mark({ className = "h-9" }) {
  return (
    <svg viewBox="0 0 60 64" className={className} fill="none"
      stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" aria-hidden="true">
      {/* Three parallelograms leaning left as they descend, stepped so the
          small one sits off the shoulder of the large one. Stroke scales with
          the viewBox, so the outline stays even at every size. */}
      <path d="M16 3 h24 l-7 27 h-24 z" />
      <path d="M45 10 h12 l-4.5 17 h-12 z" />
      <path d="M8 34 h24 l-7 27 h-24 z" />
    </svg>
  );
}

/* Mark plus wordmark. The letterforms are wide-tracked capitals rather than
   an outlined typeface: at header size the outline fills in and reads as
   mud, while tracking survives being small. */
export default function Logo({ size = "md", className = "", withWord = true }) {
  /* The mark runs taller than the cap height beside it, as in the artwork. */
  const s = size === "lg"
    ? { mark: "h-14", word: "text-3xl", track: "0.3em" }
    : size === "sm"
      ? { mark: "h-7", word: "text-sm", track: "0.24em" }
      : { mark: "h-9", word: "text-xl", track: "0.28em" };

  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <Mark className={`${s.mark} w-auto shrink-0`} />
      {withWord && (
        <span className={`${s.word} font-semibold leading-none`} style={{ letterSpacing: s.track }}>
          LEADTECH
        </span>
      )}
    </span>
  );
}
