# Phase 5.1 – WidgetSpec v1.0

## Contract summary
- `version`: literal `"1.0"` to signal the schema version.
- `profileId`: string identifier for the profile that owns this plan.
- `widgets`: array of widgets defined by the shared overlay widget union.

Each widget includes a required `id` (string), an optional `title`, and one of the existing overlay widget `type` values (`text`, `counter`, `timer`, `checklist`, `panel`, `eventLog`, `rate`, `projection`). The type determines the additional fields (for example, counters require `value` and `step`, a `timer` needs `seconds` and `running`, a `panel` nests other widgets in `children`, etc.).

## Example payload

```json
{
  "version": "1.0",
  "profileId": "demo-profile",
  "widgets": [
    { "id": "text-1", "type": "text", "title": "Overview", "text": "Ready for combat." },
    { "id": "counter-1", "type": "counter", "value": 0, "step": 1 },
    { "id": "timer-1", "type": "timer", "seconds": 0, "running": false },
    {
      "id": "panel-1",
      "type": "panel",
      "title": "Recent events",
      "children": [
        {
          "id": "eventlog-1",
          "type": "eventLog",
          "title": "Logs",
          "eventType": "combat",
          "showLast": 5
        }
      ]
    }
  ]
}
```

## Validation utilities

- `src/widgetSpec/widgetSpec.ts` introduces `WidgetSpec`, the `widgetSpecSchema`, and `validateWidgetSpec(...)`.
- `src/shared/planValidation.ts` now runs both the existing `overlayPlanSchema` check and `validateWidgetSpec` so earlier plan validation flows can observe the new schema without changing runtime behavior.
- Run `scripts/validate-widgetspec.ts` (for example with `npx ts-node scripts/validate-widgetspec.ts`) to exercise the validator against a sample payload.
