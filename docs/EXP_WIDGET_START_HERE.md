# Exp/h widget roadmap (start here)

This document explains the **minimal changes** to make it possible to build an EXP/h widget
from the existing widget creator + rules UI (without hand-editing JSON).

## 1) Decide the MVP behavior
The requested widget needs:
- periodic OCR capture of EXP value
- OCR capture of spot name (or separate capture for location)
- compute EXP/h from deltas
- show EXP/h as overlay text
- persist a history table in the menu

Right now, only **single ROI OCR** + **rate calculation via rules** exist. So the first step
is to decide whether the MVP uses **one ROI** (EXP only) or requires **two ROIs** (EXP + spot)
from day one.

## 2) Expose `trackRate` in the Rules UI (lowest effort, highest impact)
The rate calculation engine already supports `trackRate`, but the UI only exposes
`setTextWidget` and `incrementCounter`.

**Change target:**
- `src/renderer/App.tsx` — rules panel should allow selecting `trackRate` and configuring:
  - regex pattern
  - target text widget
  - valueSource (match0 vs g1)
  - unit, precision, minSeconds
  - template (EXP/h ${rate}${unit}/h)

This unlocks rate updates in the overlay without needing a new widget type.

## 3) Improve widget builder to create the correct building blocks
The current `tracker` widget created by the builder is not rendered as a tracker in the overlay;
unknown widget types get converted into a text widget summary.

**Recommended fix (minimal):**
- Change the builder’s "tracker" intent to generate **two text widgets**:
  - One text widget for the **current EXP value** (populated by `setTextWidget` rule).
  - One text widget for **EXP/h** (populated by `trackRate` rule).
- Optionally generate a starter rule for `trackRate` when the builder is used.

**Change targets:**
- `src/builder/intent.ts`
- `src/builder/widgetTemplates.ts`
- `src/builder/widgetBuilderEngine.ts`

## 4) Add support for multi-ROI capture (if spot name must be OCR’ed)
Right now, there is only **one** `captureRoi` stored in settings.
To capture **EXP + spot** you’ll need either:
1) multiple ROIs in settings (e.g., `{ exp: roiA, spot: roiB }`), or
2) a single ROI plus regex parsing of both values if they appear together.

**Change targets (if multi-ROI):**
- `src/shared/ipc.ts` (settings shape)
- `src/main/storage.ts` (persistence)
- `src/main/main.ts` (apply ROI per capture)
- `src/renderer/App.tsx` (UI to select multiple ROIs)

## 5) Add history table (menu view)
There is no structured history table yet. Event log is a flat list.

**Minimal approach:**
- Create a new panel in Inspect mode (or a new tab) that
  reads from EventLog and shows a table (time, exp, exp/h, spot).
- If you want something like “Comparación de spots”, you’ll need
  a small aggregation of entries by spot.

**Change targets:**
- `src/renderer/App.tsx`
- (Optional) new small component in `src/components/`

## Suggested order of implementation
1) **Expose `trackRate` in rules UI** (quick win)
2) **Adjust widget builder** to produce correct text widgets + rule scaffolding
3) **History table** in Inspect mode (uses existing event log data)
4) **Multi-ROI capture** for spot names (only if needed for MVP)

This order gives you a working EXP/h overlay quickly, then iterates toward the full feature.
