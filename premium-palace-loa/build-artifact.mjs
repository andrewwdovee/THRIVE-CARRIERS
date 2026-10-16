/**
 * Builds the Premium Palace LOA desk for publishing as a claude.ai artifact.
 *
 *   node build-artifact.mjs
 *
 * This desk is a copy of the Thrive LOA Producer Desk, kept as its own
 * source rather than a flag on that one: the brand runs through ~30 lines
 * of visible copy, and a shared file would mean every Premium Palace edit
 * also touched a desk another company is using.
 *
 * Storage: the artifact capability. The desk saves by republishing its own
 * page, so its whole record lives in THIS artifact's version history and
 * nowhere else. There is no shared key, no shared token and no shared
 * database between this desk and Thrive's -- they cannot read each other
 * even by mistake.
 *
 * Output: premium-palace-loa/dist/artifact.html
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const body = readFileSync(join(here, "desk-app.html"), "utf8");
const style = readFileSync(join(here, "desk-style.css"), "utf8");

/* The artifact runtime supplies the document skeleton, so the title and the
   stylesheet go at the top of the body. The desk's own buildDocument()
   takes over from the first save onward and emits a full document; both
   shapes run, and this one keeps the first publish contract-shaped. */
const html = `<title>Premium Palace LOA</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style id="tc-style">${style}</style>
${body}`;

mkdirSync(join(here, "dist"), { recursive: true });
writeFileSync(join(here, "dist", "artifact.html"), html);
console.log(`Wrote premium-palace-loa/dist/artifact.html  (${(html.length / 1024).toFixed(0)} KB)`);
