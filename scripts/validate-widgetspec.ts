import { validateWidgetSpec, WidgetSpec } from "../src/widgetSpec";

const sampleSpec: WidgetSpec = {
  version: "1.0",
  profileId: "demo-profile",
  widgets: [
    { id: "text-1", type: "text", title: "Overview", text: "Ready for combat." },
    { id: "counter-1", type: "counter", value: 0, step: 1 },
    { id: "timer-1", type: "timer", seconds: 0, running: false },
    {
      id: "panel-1",
      type: "panel",
      title: "Recent events",
      children: [
        {
          id: "eventlog-1",
          type: "eventLog",
          title: "Logs",
          eventType: "combat",
          showLast: 5
        }
      ]
    }
  ]
};

const result = validateWidgetSpec(sampleSpec);
if (result.ok) {
  console.log("WidgetSpec sample is valid.");
} else {
  console.error("WidgetSpec validation failed:", result.error);
  process.exitCode = 1;
}
