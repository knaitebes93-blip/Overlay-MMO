import React from "react";
import { OverlayPlan, OverlayWidget } from "../shared/ipc";
import TextWidget from "./widgets/TextWidget";
import CounterWidget from "./widgets/CounterWidget";
import TimerWidget from "./widgets/TimerWidget";
import ChecklistWidget from "./widgets/ChecklistWidget";
import PanelWidget from "./widgets/PanelWidget";

type Props = {
  plan: OverlayPlan;
  onUpdate: (widget: OverlayWidget) => void;
};

const PlanRenderer = ({ plan, onUpdate }: Props) => {
  return (
    <div className="plan-renderer">
      {plan.widgets.map((widget) => {
        switch (widget.type) {
          case "text":
            return <TextWidget key={widget.id} widget={widget} />;
          case "counter":
            return (
              <CounterWidget key={widget.id} widget={widget} onChange={onUpdate} />
            );
          case "timer":
            return (
              <TimerWidget key={widget.id} widget={widget} onChange={onUpdate} />
            );
          case "checklist":
            return (
              <ChecklistWidget key={widget.id} widget={widget} onChange={onUpdate} />
            );
          case "panel":
            return (
              <PanelWidget key={widget.id} widget={widget} onUpdate={onUpdate} />
            );
          default:
            return null;
        }
      })}
    </div>
  );
};

export default PlanRenderer;
