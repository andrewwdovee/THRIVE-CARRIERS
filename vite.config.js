import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

/* Stamped in at build time so a deployed page can say which build it is.
   Without it there is no way to tell a deploy that landed from one that
   silently didn't — the page looks identical either way. */
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    /* The shareable preview page fills itself with made-up orders, refunds
       and requests on first open, so it shows what the portal looks like in
       use. Only `npm run artifact` sets this; a deployed build never does. */
    __DEMO__: JSON.stringify(process.env.LTF_DEMO === "1"),
  },
  server: { port: 5173 },
  build: { outDir: "dist" },
});
