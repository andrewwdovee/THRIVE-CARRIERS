/* Flattens the Vite build into one self-contained page.

   Artifacts are served under a CSP that blocks every external host, so the
   CSS and JS have to travel inside the HTML. The artifact runtime supplies
   the document skeleton, so this emits page content only — no doctype, no
   <html>/<head>/<body> wrapper. */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const dist = "dist", out = "artifact/fulfillment-desk.html";
const assets = readdirSync(join(dist, "assets"));
const js = assets.find((f) => f.endsWith(".js"));
const css = assets.find((f) => f.endsWith(".css"));
if (!js || !css) throw new Error("Run `npm run build` first — no dist/assets found.");

const code = readFileSync(join(dist, "assets", js), "utf8");
const style = readFileSync(join(dist, "assets", css), "utf8");

// A literal </script> anywhere in a string would close the tag early.
const safe = code.replace(/<\/script/gi, "<\\/script");

mkdirSync("artifact", { recursive: true });
writeFileSync(out, `<title>Fulfillment Desk</title>
<style>
${style}
</style>
<div id="root"></div>
<script type="module">
${safe}
</script>
`);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`${out} — ${kb(readFileSync(out).length)} (js ${kb(code.length)}, css ${kb(style.length)})`);
