# Handout

Client-facing material for Orison Electronics. All three carry the
**An AYiN Advisors Project** credit, as does the app shell and the customer
display.

| File | What it is |
| --- | --- |
| `demo-page.html` | Demo page to show the shop. Published as an Artifact; this is the source. |
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
