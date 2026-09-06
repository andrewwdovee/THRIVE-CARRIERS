# Brand artwork

Drop the LeadTech logo here as **`logo.svg`** (preferred) or **`logo.png`**.

It is picked up automatically — the header, the sign-in screen and anywhere
else the logo appears all read from this one file. Nothing in the code needs
changing.

- **SVG** is best: it stays sharp at every size and in both themes.
- **PNG** works; use a transparent background and at least 400px tall.
- If the file already contains the word "LEADTECH", pass `withWord={false}`
  where `<Logo/>` is used so the word is not printed twice. The sign-in
  screen is the only place that currently prints it.

Until a file is here, a plain drawn placeholder is shown so the layout does
not collapse. It is not the logo and is not meant to pass for it.
