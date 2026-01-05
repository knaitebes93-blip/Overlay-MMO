# Overlay MMO – Roadmap

## Project Principles
- Passive overlay only (no input automation)
- No client injection or memory reading
- Visual interpretation and user-provided data
- Modular, generic, MMO-agnostic
- Fast iteration via CI (PR builds, no forced releases)

---

## Phase 0 – Technical Foundation
**Goal:** Stable, installable overlay with frictionless testing.

- Transparent always-on-top overlay
- Movable and resizable windows
- Edit / Run modes
- Layout persistence per profile
- Windows installer (NSIS)
- GitHub Actions:
  - PR builds → downloadable artifacts
  - Tag builds → official releases

Outcome: *Download exe, run, test.*

---

## Phase 1 – Manual Data MVP
**Goal:** Provide real value without automation or AI.

- Core widgets:
  - Clock / timers
  - Manual counters
  - Quick notes
- Spot tracking:
  - Spot name
  - Character level
  - EXP start / end
  - Time spent
- Calculations:
  - EXP per hour
  - Time to level
- Local persistence (JSON / SQLite)

Outcome: *Know which spots perform better.*

---

## Phase 2 – Market Scanner (Passive)
**Goal:** Economic insight with minimal ban risk.

- Manual or semi-manual price input
- Historical price tracking
- Statistics:
  - Average
  - Deviation
- Visual alerts:
  - Cheap vs history
  - Expensive vs history
- Profiles per server / region

Constraints:
- No in-client scraping
- No automation

Outcome: *Know when to buy or sell.*

---

## Phase 3 – Crafting Assistant
**Goal:** Reduce crafting mistakes and inefficiency.

- User-defined recipes
- Cost estimation
- Margin calculation
- Material checklist
- Notes per recipe

Outcome: *Craft with intent, not guesswork.*

---

## Phase 4 – Visual Interpretation (AI, Opt-in)
**Goal:** Intelligent assistance without automation.

- Local OCR (opt-in)
- Visual EXP detection
- Context detection:
  - Combat vs idle
  - Active spot
- Suggestions only:
  - Better spot indicators
  - Performance deviations

Constraints:
- Informational only
- No automated actions

---

## Phase 5 – Plugin System
**Goal:** Scale without bloating the core.

- Internal plugin API
- Game-specific plugins
- Widget plugins
- Declarative configuration

---

## Phase 6 – Productization
**Goal:** Long-term sustainability.

- Signed installer
- Clear versioning
- Profile export/import
- Licensing:
  - Free: local features
  - Pro: advanced analytics / AI (local-first)

---

## Non-Goals
- No botting
- No automation of gameplay
- No memory reading
- No competitive advantage through unfair means
