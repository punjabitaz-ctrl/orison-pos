# Handout

Client-facing material for Orison Electronics. All three carry the
**An AYiN Advisors Project** credit, as does the app shell and the customer
display.

| File | What it is |
| --- | --- |
| `demo-page.html` | Demo page to show the shop. Published as an Artifact; this is the source. |
| `Orison-POS-Demo.pdf` | The same demo page as a 5-page PDF, for printing or emailing. |
| `Orison-POS-Features.pdf` | Features, capabilities and functions, with cover and contents. |
| `Orison-POS-Setup-Guide.pdf` | The whole deployment — Apps Script, domain, PWA install — on one page. |
| `orison-pos-features.md` / `orison-pos-setup.md` | Sources. Regenerate after editing. |

## Regenerating the PDFs

```bash
P="$HOME/.claude/skills/gstack/make-pdf/dist/pdf"
"$P" generate --cover --toc --title "Orison POS" --author "An AYiN Advisors Project" \
  orison-pos-features.md Orison-POS-Features.pdf
"$P" generate --no-chapter-breaks --margins 0.55in \
  orison-pos-setup.md Orison-POS-Setup-Guide.pdf
```

The setup guide must stay **one page** — check the page count after editing and
trim prose rather than shrinking the margins further.

## Regenerating the demo PDF

`make-pdf` only takes markdown, so the demo page is printed straight from the
HTML by Chromium:

```bash
CH="$HOME/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe"
"$CH" --headless --disable-gpu --no-sandbox --no-pdf-header-footer   --print-to-pdf="Orison-POS-Demo.pdf" --virtual-time-budget=10000   "file:///F:/ClaudeCode/orison-pos/docs/handout/demo-page.html"
```

The page carries its own `@media print` block. It sets
`print-color-adjust: exact` — without it Chromium drops every background fill
and the receipt, tiles and closing panel print as empty outlines — and marks
cards, table rows and the receipt `break-inside: avoid` so nothing is split
down the middle.
