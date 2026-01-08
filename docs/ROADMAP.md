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
- Stores structured overlay memory per profile.
- Adds a deterministic rules engine based on passive inputs only.
- Supports undo/redo and rollback of overlay plan states.

### Key constraints
- Rules are declarative and deterministic.
- Rules cannot trigger automation.
- Undo/redo operates on plans, not UI internals.

### Definition of Done
- [ ] Memory entries persist per profile.
- [ ] Rules react only to passive inputs.
- [ ] Undo restores previous valid plan.
- [ ] Rollback restores any past snapshot.

### Manual test steps
1. Create memory entries and restart.
2. Add a rule and verify UI updates.
3. Undo and rollback changes.

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
