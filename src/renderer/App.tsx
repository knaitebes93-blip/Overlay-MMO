import React, { useEffect, useMemo, useState } from "react";
import { DisplayInfo, OverlayPlan, OverlaySettings, OverlayWidget } from "../shared/ipc";
import { overlayPlanSchema } from "../shared/planSchema";
import { defaultPlan, plannerStub } from "./planner";
import PlanRenderer from "./PlanRenderer";

const fallbackSettings: OverlaySettings = {
  bounds: null,
  displayId: null,
  opacity: 0.92,
  clickThrough: false
};

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
        return;
      }
      const [loadedSettings, displayList, stored] = await Promise.all([
        overlayAPI.getSettings(),
        overlayAPI.getDisplays(),
        overlayAPI.loadPlan()
      ]);
      setSettings(loadedSettings);
      setDisplays(displayList);
      if (stored.warning) {
        setPlanWarning(stored.warning);
      }
      if (stored.plan) {
        setPlan(stored.plan);
      } else {
        const initialPlan = defaultPlanMemo;
        setPlan(initialPlan);
        await overlayAPI.savePlan(initialPlan);
      }
    };
    bootstrap().catch(() => undefined);
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
          {(planWarning || planError) && (
            <div className="error-banner">
              {planWarning && (
                <>
                  {planWarning}
                  {planError ? " " : ""}
                </>
              )}
              {planError && <>Plan validation failed. Keeping last valid plan. {planError}</>}
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
