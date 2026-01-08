import React from "react";
import { EventLog, RateWidget as RateWidgetType } from "../../shared/ipc";

type Props = {
  widget: RateWidgetType;
  eventLog: EventLog;
};

const RateWidget = ({ widget, eventLog }: Props) => {
  const lookbackMs = widget.lookbackMinutes * 60 * 1000;
  const since = Date.now() - lookbackMs;
  const recentCount = eventLog.entries.filter(
    (entry) => entry.eventType === widget.eventType && entry.timestamp >= since
  ).length;
  const ratePerHour = recentCount / (widget.lookbackMinutes / 60);
  const averageMinutes =
    recentCount > 0 ? (widget.lookbackMinutes / recentCount).toFixed(1) : "n/a";

  return (
    <div className="widget rate-widget">
      {widget.title && <h3>{widget.title}</h3>}
      <div className="metric-row">
        <span className="metric-label">Event type</span>
        <span className="metric-value">{widget.eventType}</span>
      </div>
      <div className="metric-row">
        <span className="metric-label">Last {widget.lookbackMinutes} min</span>
        <span className="metric-value">{recentCount} events</span>
      </div>
      <div className="metric-row">
        <span className="metric-label">Rate</span>
        <span className="metric-value">{ratePerHour.toFixed(2)} / hr</span>
      </div>
      <div className="metric-row">
        <span className="metric-label">Avg interval</span>
        <span className="metric-value">{averageMinutes} min</span>
      </div>
    </div>
  );
};

export default RateWidget;
