# Screenshot set — portfolio and Devpost

Seven high-resolution frames of the REAL production application, captured
2026-10-22 with `scripts/makeDemoFrames.mjs`. Every frame was taken only
after a **semantic assertion** passed in the page (the exact state each
frame claims is verified before the shutter), so the set cannot contain a
blank or half-rendered screen. Dimensions: **3360x2100** (1680x1050 CSS
pixels at deviceScaleFactor 2) — sharp enough for any portfolio layout.
The flagship frame (07) additionally proves the **Archival Iron palette is
active**: all six canonical tokens present verbatim on `:root` and applied
to live elements, checked programmatically before the capture.

Local files: `screenshots/` (the directory is **gitignored by design** —
the repo hygiene rule forbids tracking screenshots; `report.json` beside
the PNGs records the machine-checked dimensions and assertions).

Hosted copies (stable URLs, attached to the existing release on this
repository's `v1.0.0-hackathon` tag — all six verified HTTP 200):

| # | File | What the frame proves (assertion) | Hosted URL |
|---|---|---|---|
| 1 | 01-landing.png | idle landing: anchor form, demo presets, live Qloo connectivity | https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/01-landing.png |
| 2 | 02-worldbuilder-dossier.png | Worldbuilder markdown dossier rendered for the *David Lynch Noir* anchor | https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/02-worldbuilder-dossier.png |
| 3 | 03-experiential-resonance.png | Experiential dossier with the resonance index, anchor *Glastonbury Festival* | https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/03-experiential-resonance.png |
| 4 | 04-domain-cards.png | the cultural domain plates populated (three or more visible cards) | https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/04-domain-cards.png |
| 5 | 05-antithesis-report.png | Taste antithesis report for *Post-Punk Berlin* | https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/05-antithesis-report.png |
| 6 | 06-api-inspector.png | API Inspector open with the recorded `/api` calls of the session | https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/06-api-inspector.png |
| 7 | 07-dashboard-archival-iron.png | MAIN working dashboard with the dossier rendered, and the Archival Iron palette **proven active** (6/6 `:root` tokens + applied computed styles) | https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/07-dashboard-archival-iron.png |

Frame 07 is captured after the antithesis frame and before the inspector
frame (the inspector modal would cover the dashboard).

## Using them on the Devpost submission

1. Open the submission form ("Enter a Submission") and locate the media /
   screenshots upload area.
2. Upload the seven PNGs from `screenshots/` with these captions:

   | Frame | Caption |
   |---|---|
   | 01 | SUTO OSNOVA — landing: cultural anchor input, demo presets, live Qloo connectivity |
   | 02 | Worldbuilder mode: a full scene dossier generated from the anchor "David Lynch Noir" |
   | 03 | Experiential mode: event resonance index with weighted evidence (anchor: Glastonbury Festival) |
   | 04 | Five cultural domain plates populated from Qloo (sonic, literary, material, gastronomic, visual) |
   | 05 | Taste antithesis: the cultural antipode report for "Post-Punk Berlin" |
   | 06 | Raw API Inspector: the client call log and Qloo provenance, verbatim |
   | 07 | Main working dashboard with the active Archival Iron palette — anchor controls, rendered dossier, live connectivity |

3. Optionally illustrate the text description with the hosted URLs
   (markdown image syntax):

   ```markdown
   ![Worldbuilder dossier](https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/02-worldbuilder-dossier.png)
   ```

## Using them in a portfolio

Embed the hosted URLs directly — they are immutable release assets, no
account needed for viewers:

```markdown
![SUTO OSNOVA — Experiential resonance](https://github.com/koztechie/suto-osnova/releases/download/v1.0.0-hackathon/03-experiential-resonance.png)
```

## Regenerating the set

```bash
npm i --no-save puppeteer-core        # package.json/lock stay untouched
node scripts/makeDemoFrames.mjs      # live production
# or against a local instance:
node scripts/makeDemoFrames.mjs http://localhost:5173
```

The script auto-resolves a Chromium (any cached `ms-playwright` bundle,
then `$SHOT_BROWSER`, then the system Chrome), runs the three modes with
verified mode/seed/button state, and fails loudly (non-zero exit) if any
state assertion or status-line check does not hold.

**Never commit the PNGs** — `screenshots/` is gitignored and
`scripts/verifyRepoHygiene.mjs` fails the build if a screenshot ever gets
tracked. Hosted copies live in the release, not in the repository tree.
