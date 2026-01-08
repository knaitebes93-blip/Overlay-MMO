import React from "react";
import { EventLog, ProjectionWidget as ProjectionWidgetType } from "../../shared/ipc";

type Props = {
  widget: ProjectionWidgetType;
  eventLog: EventLog;
};

const ProjectionWidget = ({ widget, eventLog }: Props) => {
  const lookbackMs = widget.lookbackMinutes * 60 * 1000;
  const since = Date.now() - lookbackMs;
  const recentCount = eventLog.entries.filter(
    (entry) => entry.eventType === widget.eventType && entry.timestamp >= since
  ).length;
  const ratePerHour = recentCount / (widget.lookbackMinutes / 60);
  const projected = ratePerHour * (widget.horizonMinutes / 60);
  const projectionDisplay = Number.isFinite(projected) ? projected.toFixed(1) : "0.0";

  return (
    <div className="widget projection-widget">
      {widget.title && <h3>{widget.title}</h3>}
      <div className="metric-row">
        <span className="metric-label">Event type</span>
        <span className="metric-value">{widget.eventType}</span>
      </div>
      <div className="metric-row">
        <span className="metric-label">Recent ({widget.lookbackMinutes} min)</span>
        <span className="metric-value">{recentCount} events</span>
      </div>
      <div className="metric-row">
        <span className="metric-label">Projected next {widget.horizonMinutes} min</span>
        <span className="metric-value">{projectionDisplay} events</span>
      </div>
    </div>
  );
};

export default ProjectionWidget;
