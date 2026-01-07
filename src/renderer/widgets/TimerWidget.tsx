import React, { useEffect } from "react";
import { TimerWidget as TimerWidgetType } from "../../shared/ipc";

type Props = {
  widget: TimerWidgetType;
  onChange: (next: TimerWidgetType) => void;
};

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const TimerWidget = ({ widget, onChange }: Props) => {
  useEffect(() => {
    if (!widget.running) {
      return;
    }
    const timer = window.setInterval(() => {
      onChange({ ...widget, seconds: widget.seconds + 1 });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [widget, onChange]);

  return (
    <div className="widget">
      {widget.title && <h3>{widget.title}</h3>}
      <div className="timer-display">{formatTime(widget.seconds)}</div>
      <div className="timer-controls">
        <button type="button" onClick={() => onChange({ ...widget, running: !widget.running })}>
          {widget.running ? "Stop" : "Start"}
        </button>
        <button type="button" onClick={() => onChange({ ...widget, seconds: 0, running: false })}>
          Reset
        </button>
      </div>
    </div>
  );
};

export default TimerWidget;
