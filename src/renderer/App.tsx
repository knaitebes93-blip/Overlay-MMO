import React, { useEffect, useMemo, useState } from "react";
import {
  DisplayInfo,
  EventLog,
  EventLogEntry,
  OverlayPlan,
  OverlaySettings,
  OverlayWidget
} from "../shared/ipc";
import { overlayPlanSchema } from "../shared/planSchema";
import { defaultPlan, plannerStub } from "./planner";
import PlanRenderer from "./PlanRenderer";

const fallbackSettings: OverlaySettings = {
  bounds: null,
  displayId: null,
  opacity: 0.92,
  clickThrough: false
};

const emptyEventLog: EventLog = { version: "1.0", entries: [] };

const updateWidgetById = (
  widgets: OverlayWidget[],
  updated: OverlayWidget
): OverlayWidget[] => {
  return widgets.map((widget) => {
    if (widget.id === updated.id) {
      return updated;
    }
    if (widget.type === "panel") {
      return {
        ...widget,
        children: updateWidgetById(widget.children, updated)
      };
    }
    return widget;
  });
};

const App = () => {
  const [settings, setSettings] = useState<OverlaySettings | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [plan, setPlan] = useState<OverlayPlan | null>(null);
  const [lastValidPlan, setLastValidPlan] = useState<OverlayPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planWarning, setPlanWarning] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<EventLog>(emptyEventLog);
  const [eventLogError, setEventLogError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [plannerNote, setPlannerNote] = useState("Ready.");
  const overlayAPI = window.overlayAPI;
  const defaultPlanMemo = useMemo(() => defaultPlan(), []);

  useEffect(() => {
    const bootstrap = async () => {
      if (!overlayAPI) {
        setPlannerNote("Preload bridge not loaded. Restart dev server after rebuilding Electron.");
        setSettings(fallbackSettings);
        setPlan(defaultPlanMemo);
        setEventLog(emptyEventLog);
        return;
      }

      const [settingsResult, displaysResult, planResult] = await Promise.allSettled([
        overlayAPI.getSettings(),
        overlayAPI.getDisplays(),
        overlayAPI.loadPlan()
      ]);

      if (settingsResult.status === "fulfilled") {
        setSettings(settingsResult.value);
      } else {
        setSettings(fallbackSettings);
        setPlannerNote(
          `Failed to load settings. ${settingsResult.reason instanceof Error ? settingsResult.reason.message : ""}`.trim()
        );
      }

      if (displaysResult.status === "fulfilled") {
        setDisplays(displaysResult.value);
      } else {
        setDisplays([]);
      }

      if (planResult.status === "fulfilled") {
        const stored = planResult.value;
        if (stored.warning) {
          setPlanWarning(stored.warning);
        }
        if (stored.plan) {
          const hasPhase2Widgets = stored.plan.widgets.some((widget) => {
            if (widget.type === "eventLog" || widget.type === "rate" || widget.type === "projection") {
              return true;
            }
            if (widget.type === "panel") {
              return widget.children.some(
                (child) =>
                  child.type === "eventLog" || child.type === "rate" || child.type === "projection"
              );
            }
            return false;
          });
          if (!hasPhase2Widgets) {
            setPlannerNote("Loaded saved plan. Tip: type 'reset' to load Phase 2 widgets.");
          }
          setPlan(stored.plan);
        } else {
          const initialPlan = defaultPlanMemo;
          setPlan(initialPlan);
          await overlayAPI.savePlan(initialPlan);
        }
      } else {
        const initialPlan = defaultPlanMemo;
        setPlan(initialPlan);
        overlayAPI.savePlan(initialPlan).catch(() => undefined);
      }

      if (typeof overlayAPI.loadEventLog === "function") {
        try {
          const loadedEventLog = await overlayAPI.loadEventLog();
          setEventLog(loadedEventLog);
          setEventLogError(null);
        } catch (error: unknown) {
          setEventLog(emptyEventLog);
          setEventLogError(
            error instanceof Error
              ? error.message
              : "Failed to load event log. Restart Electron to load updated IPC handlers."
          );
        }
      } else {
        setEventLog(emptyEventLog);
        setEventLogError("Event log API not available. Restart Electron to load updated IPC handlers.");
      }
    };
    bootstrap().catch((error: unknown) => {
      setSettings(fallbackSettings);
      setPlan(defaultPlanMemo);
      setEventLog(emptyEventLog);
      setPlannerNote(error instanceof Error ? error.message : "Bootstrap failed.");
    });
  }, [overlayAPI, defaultPlanMemo]);

  useEffect(() => {
    if (!plan) {
      return;
    }
    const result = overlayPlanSchema.safeParse(plan);
    if (result.success) {
      setLastValidPlan(plan);
      setPlanError(null);
    } else {
      setPlanError(result.error.errors.map((err) => err.message).join("; "));
    }
  }, [plan]);

  useEffect(() => {
    if (!overlayAPI) {
      return;
    }
    return overlayAPI.onEscapeHatch(() => {
      setPlannerNote("Escape hatch used: overlay unlocked.");
      setSettings((prev) => (prev ? { ...prev, clickThrough: false } : prev));
    });
  }, [overlayAPI]);

  const activePlan = useMemo(
    () => lastValidPlan ?? plan ?? defaultPlanMemo,
    [lastValidPlan, plan, defaultPlanMemo]
  );

  const saveSettings = async (next: OverlaySettings) => {
    setSettings(next);
    if (!overlayAPI) {
      return;
    }
    await overlayAPI.saveSettings(next);
  };

  const handleOpacityChange = (value: number) => {
    if (!settings) {
      return;
    }
    saveSettings({ ...settings, opacity: value });
  };

  const handleClickThroughToggle = () => {
    if (!settings) {
      return;
    }
    saveSettings({ ...settings, clickThrough: !settings.clickThrough });
  };

  const handleDisplayChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const displayId = Number(event.target.value);
    if (overlayAPI) {
      await overlayAPI.setDisplay(displayId);
    }
    if (settings) {
      saveSettings({ ...settings, displayId });
    }
  };

  const handleWidgetUpdate = (updated: OverlayWidget) => {
    if (!plan) {
      return;
    }
    const next = { ...plan, widgets: updateWidgetById(plan.widgets, updated) };
    setPlan(next);
    overlayAPI?.savePlan(next).catch((error: unknown) => {
      setPlanError(error instanceof Error ? error.message : "Failed to save plan.");
    });
  };

  const persistEventLog = async (next: EventLog) => {
    if (!overlayAPI || typeof overlayAPI.saveEventLog !== "function") {
      setEventLogError("Event log API not available. Restart Electron to load updated IPC handlers.");
      return;
    }
    try {
      await overlayAPI.saveEventLog(next);
      setEventLogError(null);
    } catch (error: unknown) {
      setEventLogError(
        error instanceof Error ? error.message : "Failed to save event log."
      );
    }
  };

  const handleAddEventEntry = (entry: EventLogEntry) => {
    setEventLog((prev) => {
      const next = { ...prev, entries: [...prev.entries, entry] };
      persistEventLog(next).catch(() => undefined);
      return next;
    });
  };

  const handleChatSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!plan) {
      return;
    }
    const result = plannerStub(chatInput, plan);
    setPlannerNote(result.note);
    setChatInput("");
    const validation = overlayPlanSchema.safeParse(result.plan);
    if (validation.success) {
      setPlan(result.plan);
      setLastValidPlan(result.plan);
      setPlanError(null);
      setPlanWarning(null);
      if (overlayAPI) {
        await overlayAPI.savePlan(result.plan);
      }
    } else {
      setPlanError(validation.error.errors.map((err) => err.message).join("; "));
    }
  };

  return (
    <div className="app-root">
      <header className="top-bar">
        <div className="controls">
          <div className="control-group">
            <span className="label">Opacity</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.02}
              value={settings?.opacity ?? 0.92}
              onChange={(event) => handleOpacityChange(Number(event.target.value))}
            />
          </div>
          <button type="button" onClick={handleClickThroughToggle}>
            {settings?.clickThrough ? "Unlock (Interactive)" : "Lock (Click-through)"}
          </button>
          <div className="control-group">
            <span className="label">Display</span>
            <select value={settings?.displayId ?? ""} onChange={handleDisplayChange}>
              <option value="" disabled>
                Choose display
              </option>
              {displays.map((display) => (
                <option key={display.id} value={display.id}>
                  {display.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="escape-hatch">
          Escape Hatch: <strong>Ctrl + Shift + O</strong>
        </div>
      </header>

      <main className="content">
        <section className="overlay-panel">
          {(planWarning || planError || eventLogError) && (
            <div className="error-banner">
              {planWarning && <div>{planWarning}</div>}
              {planError && (
                <div>
                  Plan validation failed. Keeping last valid plan. {planError}
                </div>
              )}
              {eventLogError && <div>Event log error. {eventLogError}</div>}
            </div>
          )}
          {activePlan && (
            <PlanRenderer
              plan={activePlan}
              eventLog={eventLog}
              onAddEventEntry={handleAddEventEntry}
              onUpdate={handleWidgetUpdate}
            />
          )}
        </section>

        <aside className="chat-panel">
          <h2>AI Composer MVP</h2>
          <p className="planner-note">{plannerNote}</p>
          <form onSubmit={handleChatSubmit}>
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Try: text: Welcome to the raid"
              rows={6}
            />
            <button type="submit">Compose Plan</button>
          </form>
          <div className="chat-hints">
            <p>Planner commands:</p>
            <ul>
              <li><strong>reset</strong> - restore default overlay plan</li>
              <li><strong>text: ...</strong> - create a text-only plan</li>
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
};

export default App;
