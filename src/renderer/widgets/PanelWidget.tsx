import React from "react";
import { EventLog, EventLogEntry, PanelWidget as PanelWidgetType, OverlayWidget } from "../../shared/ipc";
import TextWidget from "./TextWidget";
import CounterWidget from "./CounterWidget";
import TimerWidget from "./TimerWidget";
import ChecklistWidget from "./ChecklistWidget";
import EventLogWidget from "./EventLogWidget";
import RateWidget from "./RateWidget";
import ProjectionWidget from "./ProjectionWidget";

type Props = {
  widget: PanelWidgetType;
  eventLog: EventLog;
  onAddEventEntry: (entry: EventLogEntry) => void;
  onUpdate: (widget: OverlayWidget) => void;
};

const PanelWidget = ({ widget, eventLog, onAddEventEntry, onUpdate }: Props) => {
  const updateChild = (child: OverlayWidget) => {
    onUpdate({
      ...widget,
      children: widget.children.map((item) => (item.id === child.id ? child : item))
    });
  };

  return (
    <div className="widget panel-widget">
      {widget.title && <h3>{widget.title}</h3>}
      <div className="panel-children">
        {widget.children.map((child) => {
          switch (child.type) {
            case "text":
              return <TextWidget key={child.id} widget={child} />;
            case "counter":
              return (
                <CounterWidget
                  key={child.id}
                  widget={child}
                  onChange={updateChild}
                />
              );
            case "timer":
              return (
                <TimerWidget key={child.id} widget={child} onChange={updateChild} />
              );
            case "checklist":
              return (
                <ChecklistWidget
                  key={child.id}
                  widget={child}
                  onChange={updateChild}
                />
              );
            case "panel":
              return (
                <PanelWidget
                  key={child.id}
                  widget={child}
                  eventLog={eventLog}
                  onAddEventEntry={onAddEventEntry}
                  onUpdate={updateChild}
                />
              );
            case "eventLog":
              return (
                <EventLogWidget
                  key={child.id}
                  widget={child}
                  eventLog={eventLog}
                  onAddEntry={onAddEventEntry}
                  onUpdate={updateChild}
                />
              );
            case "rate":
              return <RateWidget key={child.id} widget={child} eventLog={eventLog} />;
            case "projection":
              return (
                <ProjectionWidget key={child.id} widget={child} eventLog={eventLog} />
              );
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
};

export default PanelWidget;
