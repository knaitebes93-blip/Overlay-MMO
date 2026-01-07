import React from "react";
import { PanelWidget as PanelWidgetType, OverlayWidget } from "../../shared/ipc";
import TextWidget from "./TextWidget";
import CounterWidget from "./CounterWidget";
import TimerWidget from "./TimerWidget";
import ChecklistWidget from "./ChecklistWidget";

type Props = {
  widget: PanelWidgetType;
  onUpdate: (widget: OverlayWidget) => void;
};

const PanelWidget = ({ widget, onUpdate }: Props) => {
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
                <PanelWidget key={child.id} widget={child} onUpdate={updateChild} />
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
