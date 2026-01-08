import React from "react";
import { EventLog, EventLogEntry, OverlayPlan, OverlayWidget } from "../shared/ipc";
import TextWidget from "./widgets/TextWidget";
import CounterWidget from "./widgets/CounterWidget";
import TimerWidget from "./widgets/TimerWidget";
import ChecklistWidget from "./widgets/ChecklistWidget";
import PanelWidget from "./widgets/PanelWidget";
import EventLogWidget from "./widgets/EventLogWidget";
import RateWidget from "./widgets/RateWidget";
import ProjectionWidget from "./widgets/ProjectionWidget";

type Props = {
  plan: OverlayPlan;
  eventLog: EventLog;
  onAddEventEntry: (entry: EventLogEntry) => void;
  onUpdate: (widget: OverlayWidget) => void;
};

const PlanRenderer = ({ plan, eventLog, onAddEventEntry, onUpdate }: Props) => {
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
              <PanelWidget
                key={widget.id}
                widget={widget}
                eventLog={eventLog}
                onAddEventEntry={onAddEventEntry}
                onUpdate={onUpdate}
              />
            );
          case "eventLog":
            return (
              <EventLogWidget
                key={widget.id}
                widget={widget}
                eventLog={eventLog}
                onAddEntry={onAddEventEntry}
                onUpdate={onUpdate}
              />
            );
          case "rate":
            return <RateWidget key={widget.id} widget={widget} eventLog={eventLog} />;
          case "projection":
            return (
              <ProjectionWidget key={widget.id} widget={widget} eventLog={eventLog} />
            );
          default:
            return null;
        }
      })}
    </div>
  );
};

export default PlanRenderer;
