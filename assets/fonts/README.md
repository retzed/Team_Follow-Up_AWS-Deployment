# Follow-Up bundled typography

These WOFF2 files are part of the application and are served from the same origin as `index.html`. The application does not request fonts from Google Fonts, a CDN, or any other remote host.

## Font roles

| Role | Family | Application use |
| --- | --- | --- |
| Interface | Inter | Navigation, buttons, labels, filters, inputs, and general UI |
| Item names and headings | Manrope | Project, job, task, and follow-up names; section headings; the item-name editor |
| Descriptions and body copy | Source Sans 3 | Item descriptions, activity copy, and longer explanatory text |
| Dates and time values | IBM Plex Mono | Activity-table time/date cells and timestamp values |
| Arabic glyph coverage | Noto Sans Arabic | Arabic fallback for all typography roles |

Inter, Manrope, Source Sans 3, and Noto Sans Arabic use variable WOFF2 files. IBM Plex Mono includes regular and semibold WOFF2 files. Latin and Latin Extended subsets are separated so the browser can request the correct local file for the characters in use. The Arabic subset is included locally as well.

## Offline and deployment behavior

- All font URLs are relative to this folder and resolve on GitHub Pages and AWS Amplify hosting.
- No network connection to a font provider is needed after the application assets are available on the device.
- The CSS uses `font-display: swap` and system-font fallbacks so text remains visible if a browser cannot load WOFF2.
- Keep the font files and their corresponding `LICENSE-*.txt` files together when moving or deploying the application.

## Font projects and licenses

All bundled families are distributed under the SIL Open Font License 1.1. The corresponding copyright notices and complete license texts are stored beside the font files.

- Inter — https://github.com/rsms/inter — `LICENSE-Inter.txt`
- Manrope — https://github.com/sharanda/manrope — `LICENSE-Manrope.txt`
- Source Sans 3 — https://github.com/adobe-fonts/source-sans — `LICENSE-Source-Sans-3.txt`
- Noto Sans Arabic — https://github.com/notofonts/arabic — `LICENSE-Noto-Sans-Arabic.txt`
- IBM Plex Mono — https://github.com/IBM/plex — `LICENSE-IBM-Plex-Mono.txt`
