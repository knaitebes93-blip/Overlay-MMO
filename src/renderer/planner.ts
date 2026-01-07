import { OverlayPlan, PlannerResult } from "../shared/ipc";

const buildPlan = (widgets: OverlayPlan["widgets"]): OverlayPlan => ({
  version: "1.0",
  widgets
});

export const defaultPlan = (): OverlayPlan =>
  buildPlan([
    {
      id: "panel-core",
      type: "panel",
      title: "Raid Snapshot",
      children: [
        {
          id: "text-welcome",
          type: "text",
          title: "Status",
          text: "Overlay MMO is running in passive mode."
        },
        {
          id: "counter-runs",
          type: "counter",
          title: "Dungeon Runs",
          value: 0,
          step: 1
        },
        {
          id: "timer-session",
          type: "timer",
          title: "Session Timer",
          seconds: 0,
          running: false
        },
        {
          id: "checklist-goals",
          type: "checklist",
          title: "Objectives",
          items: [
            { id: "item-1", text: "Check mail", checked: false },
            { id: "item-2", text: "Restock potions", checked: false }
          ]
        }
      ]
    }
  ]);

export const plannerStub = (message: string, previousPlan: OverlayPlan): PlannerResult => {
  const trimmed = message.trim();
  if (!trimmed) {
    return { plan: previousPlan, note: "No changes: empty message." };
  }

  if (trimmed.toLowerCase() === "reset") {
    return { plan: defaultPlan(), note: "Plan reset to defaults." };
  }

  if (trimmed.toLowerCase().startsWith("text:")) {
    const text = trimmed.slice(5).trim() || "New text widget";
    return {
      plan: buildPlan([
        {
          id: `text-${Date.now()}`,
          type: "text",
          title: "Planner Note",
          text
        }
      ]),
      note: "Planner created a text-only plan."
    };
  }

  return {
    plan: buildPlan([
      {
        id: `panel-${Date.now()}`,
        type: "panel",
        title: "Composer Output",
        children: [
          {
            id: `text-${Date.now()}`,
            type: "text",
            title: "Planner Message",
            text: trimmed
          }
        ]
      }
    ]),
    note: "Planner converted message into a simple panel plan."
  };
};
