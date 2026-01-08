# Phase 5.3 + 5.4 – Widget Templates + Builder Engine

This step introduces deterministic widget templates and a local builder engine. It does not call external APIs and does not evaluate formulas.

## Supported commands (examples)
- `text: hello`
- `timer respawn 15m`
- `xp/h start 20 end 35 in 30m`
- `roi cost 100 revenue 150 fee 10%`
- `table market columns item,buy,sell`

## How the Q/A loop works
1. Submit a chat message in Compose mode.
2. The builder drafts widgets from templates and extracts any values it can.
3. If required fields are missing, it returns `nextQuestions`.
4. Fill the answers and click Continue to re-run the builder.
5. When all required fields are present, the builder returns a validated draft WidgetSpec plan.

## Determinism rules
- Widget IDs are stable and derived from a hash of the message plus intent order.
- No randomness, timestamps, or dynamic execution is used.
- Re-running with the same message + answers yields the same draft plan.

## Notes
- Draft WidgetSpec plans are stored as candidates only (no persistence or migration yet).
- Overlay rendering continues to use the legacy plan until Phase 5.5.
- Timer durations are normalized to seconds in `data.values.duration`.
- ROI `fee_fixed` defaults to 0 when omitted.
