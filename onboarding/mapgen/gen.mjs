/* Turns the us-atlas TopoJSON into one SVG path per state, projected
   Albers USA (which tucks Alaska and Hawaii in as insets) and fitted to
   a fixed viewBox. Output is a flat {AL: "M..."} map plus a label point
   per state, which is all the page needs — no runtime d3, no CDN. */
import { readFileSync, writeFileSync } from "node:fs";
import * as topojson from "topojson-client";
import { geoAlbersUsa, geoPath, geoCentroid } from "d3-geo";

const W = 960, H = 600;
const topo = JSON.parse(readFileSync("node_modules/us-atlas/states-10m.json", "utf8"));
const fc = topojson.feature(topo, topo.objects.states);

/* us-atlas keys states by FIPS; the page wants postal codes. */
const FIPS = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC",
  "12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY",
  "22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT",
  "31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH",
  "40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT",
  "50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY",
};

const keep = fc.features.filter((f) => FIPS[f.id] && FIPS[f.id] !== "DC");
const proj = geoAlbersUsa().fitExtent([[12, 12], [W - 12, H - 12]], { type: "FeatureCollection", features: keep });
const path = geoPath(proj);

/* Whole pixels at 960x600 is more precision than a 1100px-wide map can
   show, and it halves the file. Points that collapse onto each other
   after rounding are dropped rather than left as no-op line segments. */
function round(d) {
  const snapped = d.replace(/-?\d+(\.\d+)?/g, (n) => String(Math.round(+n)));
  return snapped.replace(/L(-?\d+),(-?\d+)(?=L\1,\2(?![\d.]))/g, "")
    .replace(/(L-?\d+,-?\d+)\1+/g, "$1");
}
const states = {};
const labels = {};
for (const f of keep) {
  const code = FIPS[f.id];
  const d = path(f);
  if (!d) { console.error("no path for " + code); continue; }
  states[code] = round(d);
  const c = proj(geoCentroid(f));
  if (c) labels[code] = [Math.round(c[0]), Math.round(c[1])];
}
/* A few centroids land badly (long tails, island chains). */
Object.assign(labels, {
  FL: [820, 505], LA: [617, 470], MI: [697, 243], AK: [148, 495], HI: [275, 540],
  ID: [243, 178], CA: [108, 300], MD: [861, 294], NJ: [880, 264], DE: [874, 283],
  RI: [918, 222], CT: [905, 229], MA: [913, 209], NH: [906, 184], VT: [893, 177],
});
const out = { viewBox: [0, 0, W, H].join(" "), states, labels };
writeFileSync("../us-states.json", JSON.stringify(out));
console.log("states:", Object.keys(states).length,
  " bytes:", JSON.stringify(out).length,
  " avg path:", Math.round(Object.values(states).join("").length / Object.keys(states).length));
