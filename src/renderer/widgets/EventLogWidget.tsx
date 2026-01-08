import React, { useEffect, useMemo, useState } from "react";
import { EventLog, EventLogEntry, EventLogWidget as EventLogWidgetType } from "../../shared/ipc";

type Props = {
  widget: EventLogWidgetType;
  eventLog: EventLog;
  onAddEntry: (entry: EventLogEntry) => void;
  onUpdate: (widget: EventLogWidgetType) => void;
};

const buildEntryId = () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `event-${Date.now()}-${suffix}`;
};

const formatRelativeTime = (timestamp: number) => {
  const deltaMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const EventLogWidget = ({ widget, eventLog, onAddEntry, onUpdate }: Props) => {
  const [note, setNote] = useState("");
  const [eventTypeInput, setEventTypeInput] = useState(widget.eventType);

  useEffect(() => {
    setEventTypeInput(widget.eventType);
  }, [widget.eventType]);

  const filteredEntries = useMemo(
    () => eventLog.entries.filter((entry) => entry.eventType === widget.eventType),
    [eventLog.entries, widget.eventType]
  );

  const visibleEntries = useMemo(
    () => filteredEntries.slice(-widget.showLast).reverse(),
    [filteredEntries, widget.showLast]
  );

  const commitEventType = () => {
    const trimmed = eventTypeInput.trim();
    if (!trimmed) {
      setEventTypeInput(widget.eventType);
      return;
    }
    if (trimmed !== widget.eventType) {
      onUpdate({ ...widget, eventType: trimmed });
    }
  };

  const handleAdd = () => {
    const trimmedInput = eventTypeInput.trim();
    const eventType = trimmedInput || widget.eventType.trim();
    if (!eventType) {
      return;
    }
    if (trimmedInput && trimmedInput !== widget.eventType) {
      onUpdate({ ...widget, eventType: trimmedInput });
    }
    const entry: EventLogEntry = {
      id: buildEntryId(),
      eventType,
      timestamp: Date.now(),
      note: note.trim() ? note.trim() : undefined
    };
    onAddEntry(entry);
    setNote("");
  };

  return (
    <div className="widget event-log-widget">
      {widget.title && <h3>{widget.title}</h3>}
      <div className="event-log-config">
        <span className="event-log-label">Event type</span>
        <input
          type="text"
          value={eventTypeInput}
          onChange={(event) => setEventTypeInput(event.target.value)}
          onBlur={commitEventType}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitEventType();
            }
          }}
        />
      </div>
      <div className="event-log-actions">
        <input
          type="text"
          placeholder="Optional note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="button" onClick={handleAdd}>
          Add event
        </button>
      </div>
      <div className="event-log-summary">
        Total: {filteredEntries.length} | Showing last {Math.min(widget.showLast, filteredEntries.length)}
      </div>
      {visibleEntries.length === 0 ? (
        <p className="event-log-empty">No events logged yet.</p>
      ) : (
        <ul className="event-log-list">
          {visibleEntries.map((entry) => (
            <li key={entry.id}>
              <span className="event-log-time">{formatRelativeTime(entry.timestamp)}</span>
              <span className="event-log-note">{entry.note ?? "Logged event"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EventLogWidget;
