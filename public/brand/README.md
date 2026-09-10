# Brand assets

Two files belong here, and both are yours to drop in — they were attached in
chat and could not be written to disk from there.

  favicon.png   the orange/blue T mark. Square, 512x512 or larger.
  logo.png      the Schoolivio mortarboard-and-book mark with the wordmark.

## favicon.png

`public/index.html` already points at it. Save the file and it appears in the
browser tab on every page — nothing else to change.

Until it exists the tab falls back to `favicon.svg`, a drawn version of the
Schoolivio mark that ships with the app.

## logo.png

Optional. The sign-in screens and the sidebar draw the Schoolivio mark as SVG
(`src/Components/Logo.jsx`), which stays sharp at any size, works on both
light and dark, and costs no request — so the raster is only needed if you
want the exact artwork rather than the drawn one.

A school's OWN logo is separate again: that is uploaded per tenant on the
School page and replaces the mark in that school's sidebar.
