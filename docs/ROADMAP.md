# Overlay MMO Roadmap

## Phase 0: Overlay window/runtime

**What the app does in this phase**
- Runs a transparent, always-on-top overlay window on Windows.
- Supports click-through and interactive modes with a safe escape hatch.
- Persists window bounds, opacity, and display selection.

**Definition of Done**
- [x] `npm run dev` launches the overlay window without errors.
- [x] Window stays on top and can be moved/resized in interactive mode.
- [x] Click-through mode ignores mouse input and is recoverable via escape hatch.
- [x] Opacity changes persist after restarting the app.
- [ ] Display selection persists and repositions the window on restart.

**Manual test steps (Windows)**
1. Run `npm install`, then `npm run dev`.
2. Verify the overlay appears on top of other windows.
3. Toggle “Lock (Click-through)” and confirm mouse clicks pass through.
4. Press the escape hatch shortcut and confirm interactivity returns.
5. Adjust opacity and move the window; restart and confirm persistence.

## Phase 1: Chat → Plan → UI (AI Composer MVP)

**What the app does in this phase**
- Accepts chat commands and generates a simple Overlay Plan.
- Validates plans with Zod and renders the resulting widgets.
- Keeps the last known good plan if validation fails.

**Definition of Done**
- [x] Chat panel accepts messages and triggers planner output.
- [x] Invalid plans surface an error and keep the last valid plan.
- [x] Widgets render from the plan with the expected data.

**Manual test steps (Windows)**
1. Type `text: Hello overlay` and submit.
2. Confirm the plan renders a text widget with the message.
3. Type `reset` and confirm defaults return.
4. Force an invalid plan (developer edit) and confirm the UI reports the error.

## Phase 2: Local event log + rate/projection widgets (manual data)

**What the app does in this phase**
- Allows manual logging of events locally per profile.
- Adds widgets that compute rates and projections from the log.

**Definition of Done**
- [x] Event log stores entries and reloads on restart.
- [x] Rate/projection widgets update when log entries are added.
- [x] All plan validations pass with new widget types.

**Manual test steps (Windows)**
1. Add sample event entries from the overlay UI.
2. Verify rate widgets update counts and averages.
3. Restart the app and confirm the log persists.

## Phase 3: Screen capture (opt-in) + OCR pipeline (passive)

**What the app does in this phase**
- Captures the screen only with explicit opt-in.
- Feeds captures into a passive OCR pipeline.

**Definition of Done**
- [ ] Screen capture is disabled by default.
- [ ] Opt-in toggles start/stop capture safely.
- [ ] OCR pipeline outputs structured text events.

**Manual test steps (Windows)**
1. Enable capture and confirm a clear opt-in prompt is required.
2. Verify captures are stored in the local profile.
3. Disable capture and confirm it stops immediately.

## Phase 4: Overlay memory + rules engine + undo/rollback

**What the app does in this phase**
- Stores structured overlay memories.
- Adds rules for conditional UI actions.
- Supports undo/rollback of overlay plan changes.

**Definition of Done**
- [ ] Memory entries persist per profile.
- [ ] Rules run only on passive inputs.
- [ ] Undo/rollback restores the previous plan state.

**Manual test steps (Windows)**
1. Create a rule and verify it updates the plan.
2. Use undo to revert the change.
3. Restart and confirm memory entries persist.
