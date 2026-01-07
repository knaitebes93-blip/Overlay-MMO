import React, { useEffect, useMemo, useState } from "react";
import { DisplayInfo, OverlayPlan, OverlaySettings, OverlayWidget } from "../shared/ipc";
import { overlayPlanSchema } from "./planSchema";
import { defaultPlan, plannerStub } from "./planner";
import PlanRenderer from "./PlanRenderer";

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
  const [chatInput, setChatInput] = useState("");
  const [plannerNote, setPlannerNote] = useState("Ready.");

  useEffect(() => {
    const bootstrap = async () => {
      const [loadedSettings, displayList, storedPlan] = await Promise.all([
        window.overlayAPI.getSettings(),
        window.overlayAPI.getDisplays(),
        window.overlayAPI.loadPlan()
      ]);
      setSettings(loadedSettings);
      setDisplays(displayList);
      if (storedPlan) {
        setPlan(storedPlan);
      } else {
        const initialPlan = defaultPlan();
        setPlan(initialPlan);
        await window.overlayAPI.savePlan(initialPlan);
      }
    };
    bootstrap().catch(() => undefined);
  }, []);

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
    return window.overlayAPI.onEscapeHatch(() => {
      setPlannerNote("Escape hatch used: overlay unlocked.");
      setSettings((prev) => (prev ? { ...prev, clickThrough: false } : prev));
    });
  }, []);

  const activePlan = useMemo(() => lastValidPlan ?? plan, [lastValidPlan, plan]);

  const saveSettings = async (next: OverlaySettings) => {
    setSettings(next);
    await window.overlayAPI.saveSettings(next);
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
    await window.overlayAPI.setDisplay(displayId);
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
    window.overlayAPI.savePlan(next).catch(() => undefined);
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
      await window.overlayAPI.savePlan(result.plan);
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
          {planError && (
            <div className="error-banner">
              Plan validation failed. Keeping last valid plan. {planError}
            </div>
          )}
          {activePlan && (
            <PlanRenderer plan={activePlan} onUpdate={handleWidgetUpdate} />
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
