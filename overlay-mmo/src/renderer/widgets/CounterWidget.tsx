import React from "react";
import { CounterWidget as CounterWidgetType } from "../../shared/ipc";

type Props = {
  widget: CounterWidgetType;
  onChange: (next: CounterWidgetType) => void;
};

const CounterWidget = ({ widget, onChange }: Props) => {
  const update = (delta: number) => {
    onChange({ ...widget, value: widget.value + delta });
  };

  return (
    <div className="widget">
      {widget.title && <h3>{widget.title}</h3>}
      <div className="counter">
        <button type="button" onClick={() => update(-widget.step)}>
          -
        </button>
        <span>{widget.value}</span>
        <button type="button" onClick={() => update(widget.step)}>
          +
        </button>
      </div>
    </div>
  );
};

export default CounterWidget;
