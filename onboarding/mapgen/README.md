# Regenerating the map

`../us-states.json` holds 50 SVG paths plus a label point per state, projected
Albers USA (which tucks Alaska and Hawaii in as insets) and fitted to a 960×600
box. `build-onboarding.mjs` embeds it, so `states.html` carries no runtime
dependency and no CDN call — the map works offline and cannot break because
somebody else's script moved.

Only rerun this if the geometry itself has to change. **The states we target and
what a call costs in each live in `states.html`, not here.**

```sh
cd onboarding/mapgen
npm install     # us-atlas, topojson-client, d3-geo
node gen.mjs    # writes ../us-states.json
```

Coordinates are rounded to whole pixels — finer than an 1100px-wide map can
show, and half the bytes. `node_modules` is not committed, and neither is the
lockfile; this is a once-in-a-while generator, not part of the build.
