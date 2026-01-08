# Phase 5.5 + 5.6: WidgetSpec Persistence + Snapshots

## Overview
- WidgetSpec v1.0 is the authoritative persisted plan format.
- Each profile loads a single WidgetSpec plan with a last-known-good fallback.
- All apply operations validate WidgetSpec (including safe formulas).

## Storage (per profile)
- Persisted plans live under the profile directory:
  - plan.json (current)
  - plan.last-good.json (backup)
  - plan.history.json (undo/redo)
- Memory snapshots are stored in memory.json as plan_snapshot entries.

## Load + Migration
1) Load plan.json and validate as WidgetSpec.
2) If invalid, attempt migrateLegacyPlan(payload).
3) If migration succeeds, persist the migrated WidgetSpec and use it.
4) If migration fails, fall back to a minimal notes WidgetSpec and write it to disk.

Migration rules (minimum):
- Legacy text widgets -> WidgetSpec notes.
- Unsupported widgets -> notes with original payload JSON.
- Deterministic IDs (stable hash of type + index + content).
- Cascading layout to avoid overlap.

## Apply Flow (Snapshots)
- applyPlan(nextPlan, reason, actor) behavior:
  1) Validate WidgetSpec (incl. safe formulas).
  2) Save as WidgetSpec.
  3) Create a plan_snapshot memory entry:
     - snapshotId
     - baseSnapshotId (current snapshot id)
     - planJson (WidgetSpec)
     - reason
     - actor (user | rules | system)
  4) Update currentPlan + lastKnownGoodPlan.

## Undo / Redo / Rollback
- Undo/redo/rollback restore the exact WidgetSpec planJson from snapshots.
- Restores persist to plan.json and plan.last-good.json.
- Historical rules are not re-run on restore (Phase 4 behavior preserved).

## Composer Integration
- When a draft WidgetSpec is valid and applied, it routes through applyPlan.
- Invalid drafts do not replace the current plan.
