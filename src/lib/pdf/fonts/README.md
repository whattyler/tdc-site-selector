# Fonts embedded in the PDF

Checked in rather than fetched, because a report must render identically in a
year's time and a build must not depend on Google being reachable.

| File | Source | Licence |
|---|---|---|
| `Alegreya-SemiBold.woff` | `@fontsource/alegreya@5.3.0`, `alegreya-latin-600-normal.woff` | SIL OFL 1.1 |
| `Alegreya-Bold.woff` | `@fontsource/alegreya@5.3.0`, `alegreya-latin-700-normal.woff` | SIL OFL 1.1 |
| `Carlito-Regular.ttf` | `google/fonts`, `ofl/carlito` | SIL OFL 1.1 |
| `Carlito-Bold.ttf` | `google/fonts`, `ofl/carlito` | SIL OFL 1.1 |

Alegreya is WOFF because upstream now ships only a variable TTF, and a variable
font renders at its default 400 weight in fontkit — which is not the 600/700 the
brand asks for. Fontsource's per-weight static instances are the real thing.
Carlito ships static TTFs upstream, so those are used directly.
