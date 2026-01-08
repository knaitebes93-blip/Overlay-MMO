# Overlay MMO Roadmap

> Core constraints (apply to all phases)
> - Passive overlay only
> - No gameplay automation
> - No input sending
> - No memory reading or injection
> - Transparent, always-on-top overlay
> - Windows-first

---

## Phase 0: Overlay window/runtime  
**(Completed – do not modify)**

### What the app does in this phase
- Runs a transparent, always-on-top overlay window on Windows.
- Supports click-through and interactive modes with a safe escape hatch.
- Persists window bounds, opacity, and display selection.

### Definition of Done
- [x] `npm run dev` launches the overlay window without errors.
- [x] Window stays on top and can be moved/resized in interactive mode.
- [x] Click-through mode ignores mouse input and is recoverable via escape hatch.
- [x] Opacity changes persist after restarting the app.
- [x] Display selection persists and repositions the window on restart.

### Manual test steps (Windows)
1. Run `npm install`, then `npm run dev`.
2. Verify the overlay appears on top of other windows.
3. Toggle “Lock (Click-through)” and confirm mouse clicks pass through.
4. Press the escape hatch shortcut and confirm interactivity returns.
5. Adjust opacity and move the window; restart and confirm persistence.

---

## Phase 1: Chat → Plan → UI (AI Composer MVP)  
**(Completed – do not modify)**

### What the app does in this phase
- Accepts chat commands and generates a simple Overlay Plan.
- Validates plans and renders widgets from the plan.
- Keeps the last known good plan if validation fails.

### Definition of Done
- [x] Chat panel accepts messages and triggers planner output.
- [x] Invalid plans surface an error and keep the last valid plan.
- [x] Widgets render from the plan with expected data.

### Manual test steps
1. Type `text: Hello overlay`.
2. Confirm a text widget renders.
3. Type `reset` and confirm defaults return.
4. Force an invalid plan and confirm rollback.

---

## Phase 2: Local event log + rate/projection widgets (manual data)  
**(Completed – do not modify)**

### What the app does in this phase
- Allows manual logging of events per profile.
- Adds widgets that compute rates and projections.

### Definition of Done
- [x] Event log persists across restarts.
- [x] Rate/projection widgets update on new events.
- [x] Validation passes with new widget types.

### Manual test steps
1. Add sample events.
2. Verify rate widgets update.
3. Restart app and confirm persistence.

---

## Phase 3: Screen capture (opt-in) + OCR pipeline (passive)  
**(Completed – do not modify)**

### What the app does in this phase
- Captures the screen only with explicit opt-in.
- Processes captures via a passive OCR pipeline.

### Definition of Done
- [x] Capture is disabled by default.
- [x] Opt-in toggle is explicit and reversible.
- [x] OCR outputs structured text events.

### Manual test steps
1. Enable capture and confirm opt-in.
2. Verify OCR text is generated.
3. Disable capture and confirm it stops.

---

## Phase 4: Overlay memory, rules engine, undo/rollback (deterministic)

### What the app does in this phase
- Stores **structured overlay memory** per profile (overlay-only state, never game state).
- Adds a **deterministic, event-driven rules engine** that reacts only to explicitly allowed passive inputs.
- Supports **undo/redo** and **rollback** for overlay plan changes using immutable snapshots.

---

### Overlay memory (per profile)

**Storage target**
- Persist on local disk per profile (e.g., JSON/SQLite - implementation choice), versioned for migrations.

**Minimum MemoryEntry schema**
- `id: string` (uuid)
- `profileId: string`
- `type: "plan_snapshot" | "rule" | "rule_event" | "note" | "capture_meta" | "ocr_event" | "manual_event"`
- `createdAt: number` (unix ms)
- `source: "user" | "system" | "ocr" | "import"`
- `payload: object` (type-specific, validated)
- `tags?: string[]`

**Retention / limits (initial defaults)**
- Keep last **500** memory entries per profile (FIFO trimming).
- Keep last **50** plan snapshots per profile.
- Max payload size per entry: **256 KB** (reject or truncate safely).

---

### Passive inputs (allowed vs prohibited)

**Allowed passive inputs (explicit list)**
- Manual UI inputs (forms, buttons inside overlay)
- Local event log entries
- OCR outputs derived from opt-in captures (text + confidence + capture id)
- Clipboard parse (opt-in, explicit enable)
- Log import from local files (opt-in, user-selected file paths)

**Explicitly prohibited inputs**
- Reading game process memory
- Injecting into game client
- Sending mouse/keyboard inputs to the game
- Network packet capture from the game
- Any background automation that executes gameplay actions

---

### Rules engine (deterministic, event-driven)

**Rules model**
- Rules are declarative objects stored in memory with:
  - `id`, `profileId`, `enabled`
  - `when` (match conditions on passive input events)
  - `then` (overlay-only actions)

**Determinism constraints**
- Rules run **only on event arrival** (no polling loops).
- Rule evaluation is **pure**: given the same input event + same stored rule set, output is identical.
- Rule actions are overlay-only:
  - update plan (through validated patch)
  - show/hide widget
  - set widget props
  - trigger visual alert
  - append a memory entry (rule_event)

**Safety**
- Every rule action must produce a candidate plan that passes validation, otherwise discard and log an error entry.

---

### Undo/redo and rollback semantics

**Snapshot granularity**
- Any plan change (manual or rule-driven) creates a `plan_snapshot` entry:
  - `snapshotId`, `planJson`, `reason`, `actor` ("user" | "rules")
  - `baseSnapshotId` (parent pointer)

**Undo / Redo**
- Undo moves to the previous snapshot in the chain (last valid snapshot).
- Redo moves forward only if no new snapshot has been created since the undo.

**Rollback**
- Rollback selects a specific `snapshotId` and restores exactly that `planJson`.

**Rules interaction on restore**
- Restoring a snapshot **does NOT retroactively re-run rules**.
- After restore, rules resume only for **future incoming passive input events**.

---

### Definition of Done
- [x] Memory entries persist per profile and reload on restart.
- [x] Retention limits are enforced (500 entries, 50 snapshots, 256KB payload cap).
- [x] Allowed passive inputs are enforced; prohibited classes are not present in codepaths.
- [x] Rules run event-driven only (no polling), and produce deterministic overlay-only outputs.
- [x] Undo/redo works across user and rule-driven plan changes.
- [x] Rollback restores a selected snapshot exactly and does not re-run historical rules.

---

### Manual test steps (Windows)
1. Create two profiles; add distinct memory entries; restart; confirm separation and persistence.
2. Trigger multiple plan changes (user + rules) and confirm snapshots are created and capped (50 max).
3. Undo twice, redo once; confirm chain correctness and redo invalidation after a new change.
4. Roll back to an older snapshot by selecting `snapshotId`; confirm exact plan restoration.
5. Verify rules do not re-run on rollback (only on new events after restore).
6. Confirm OCR/clipboard/log-import require explicit opt-in toggles and are disabled by default.

---

## Phase 4.5: UI Restructure & Interaction Model Cleanup

### Purpose
- Reduce visual clutter and cognitive load.
- Separate runtime controls, widgets, and AI/tools.
- Establish a stable UI structure before expanding AI.

### What the app does in this phase
- Reorganizes UI into clear sections:
  1. **Overlay Runtime Bar** (top, always visible)
     - Opacity
     - Lock / Click-through
     - Display selection
     - Capture toggle
     - Escape hatch hint
  2. **Widget Canvas**
     - Renders widgets only
     - No config, no debug UI
  3. **Inspector / Tools Panel** (right, collapsible)
     - Widget inspector
     - Event log
     - Rules
     - Profiles
  4. **Composer / AI Panel** (separate mode)
     - Chat
     - Plan composition
     - AI settings

### Interaction rules
- Default mode is **Gameplay Mode** (minimal UI).
- Composer/AI tools are hidden unless explicitly enabled.
- Runtime controls never mix with widget content.
- Widgets are pure output components.

### Definition of Done
- [x] Runtime controls isolated in top bar.
- [x] Widget canvas contains widgets only.
- [x] AI Composer hidden by default.
- [x] UI modes switch cleanly without state loss.

### Manual test steps
1. Launch app → Gameplay mode.
2. Switch to Compose mode → AI tools visible.
3. Switch back → clean overlay.
4. Restart and confirm mode persistence.

---

## Phase 5: WidgetSpec standardization + Widget Builder Engine (no LLM)

### What the app does in this phase
- Introduces a formal `WidgetSpec` contract.
- All widgets are created via a Widget Builder Engine.
- Chat input maps to widget intents using templates and rules only.

### Key concepts
- Generic widget types:
  - timer
  - counter
  - tracker
  - roi_panel
  - table
  - chart
  - notes
  - alert
- Validation is authoritative.

### Definition of Done
- [ ] All widgets use `WidgetSpec`.
- [ ] Invalid specs are rejected safely.
- [ ] Existing widgets migrated.
- [ ] Chat-driven creation works without AI.

---

## Phase 6: Profile system + capability-based intelligence

### What the app does in this phase
- Adds profiles to reduce repeated configuration.
- Profiles store:
  - game name (optional)
  - currency and number format
  - daily reset time
  - enabled capabilities (manual, OCR, clipboard, logs)
- Widget Builder reuses defaults automatically.

### Definition of Done
- [ ] Profiles persist and are selectable.
- [ ] Defaults reduce follow-up questions.
- [ ] Capability constraints enforced.

---

## Phase 7: AI Mode framework (OFF by default)

### What the app does in this phase
- Adds AI Mode setting:
  - Off (default)
  - External LLM
  - Local LLM
- Introduces LLM adapter interface.
- App remains fully functional with AI Mode off.

### Definition of Done
- [ ] AI Mode selector exists.
- [ ] App runs with no API key.
- [ ] Disabled adapter works.
- [ ] Validation always overrides AI output.

---

## Phase 8: LLM-assisted Widget Builder (optional enhancement)

### What the app does in this phase
- Uses LLM only to:
  - disambiguate intent
  - suggest widget structures
  - improve question phrasing
- Deterministic engine remains authoritative.

### Definition of Done
- [ ] LLM called only on ambiguity.
- [ ] Output converted to WidgetSpec drafts.
- [ ] Invalid AI output rejected.
- [ ] AI Mode fully optional.

---

## Phase 9: Presets, templates, and UX polish

### What the app does in this phase
- Adds reusable widget templates (XP/h, ROI, timers).
- Improves auto-layout and visual grouping.
- Polishes UX around rules, profiles, and undo.

### Definition of Done
- [ ] Templates reduce setup time.
- [ ] Widgets align cleanly.
- [ ] Overlay feels predictable and focused.

---

> Important note for contributors and Codex  
> - Do NOT introduce LLM dependencies before Phase 7  
> - `WidgetSpec` and validation are the core contract  
> - AI is an assistant, never a requirement
