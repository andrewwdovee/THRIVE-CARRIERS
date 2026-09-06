import React, { useState } from "react";

/* The LeadTech logo.

   The artwork lives in public/brand/ as logo.svg or logo.png. Drop the real
   file in and it is used everywhere the logo appears — header, sign-in,
   anywhere added later — with nothing in the code to change.

   With no file there, the wordmark is set in type and no mark is drawn.
   Redrawing somebody's logo by hand from a screenshot produces something
   that is not their logo, and putting that in the code spreads the error to
   every screen at once. Type is honest: it is the company's name, correctly
   spelled, making no claim to be the artwork.

   Note for the published preview: it inlines only the JS and CSS, so files
   under public/ are not part of it and it always shows the type. The real
   site serves them normally. */

const SOURCES = ["/brand/logo.svg", "/brand/logo.png"];

const SIZES = {
  lg: { mark: "h-14", word: "text-3xl", track: "0.3em" },
  md: { mark: "h-9", word: "text-xl", track: "0.28em" },
  sm: { mark: "h-7", word: "text-sm", track: "0.24em" },
};

function Word({ s, className = "" }) {
  return (
    <span className={`${s.word} font-semibold leading-none ${className}`} style={{ letterSpacing: s.track }}>
      LEADTECH
    </span>
  );
}

/* The symbol on its own, for places too tight for the word. Renders nothing
   until there is a file — callers that need a guaranteed mark should use
   <Logo/>, which falls back to the word. */
export function Mark({ className = "h-9" }) {
  const [i, setI] = useState(0);
  if (i >= SOURCES.length) return null;
  return (
    <img src={SOURCES[i]} alt="" aria-hidden="true"
      className={`${className} w-auto object-contain`}
      onError={() => setI((n) => n + 1)} />
  );
}

/* withWord={false} asks for the symbol alone — honoured only when there is
   artwork to show. Without it the word is all there is, so it is printed
   regardless rather than leaving a header with nothing in it. */
export default function Logo({ size = "md", className = "", withWord = true }) {
  const s = SIZES[size] || SIZES.md;
  const [i, setI] = useState(0);
  const haveArt = i < SOURCES.length;

  if (!haveArt) return <Word s={s} className={className} />;

  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <img src={SOURCES[i]} alt="LeadTech"
        className={`${s.mark} w-auto shrink-0 object-contain`}
        onError={() => setI((n) => n + 1)} />
      {withWord && <Word s={s} />}
    </span>
  );
}
