# Fonts

Served from here (`next/font/local` in `../layout.tsx`) so the build does not need Google Fonts and the pages never contact it.

| File | Font | Weights | Subset |
|---|---|---|---|
| `sora-latin.woff2` | Sora (variable) | 400 to 700 | latin (covers ë, ç) |
| `ibm-plex-mono-400-latin.woff2`, `ibm-plex-mono-500-latin.woff2` | IBM Plex Mono | 400, 500 | latin |

Both families are licensed under the SIL Open Font License 1.1, which allows bundling. Downloaded from fonts.gstatic.com (Google Fonts, Sora v17, IBM Plex Mono v23). To add a character set (for example latin-ext), download its woff2 from the same stylesheet and add a `src` entry.
