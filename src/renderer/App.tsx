import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureRoi,
  CaptureSnapshotResult,
  CaptureSource,
  CaptureSourceType,
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
  clickThrough: false,
  captureEnabled: false,
  captureSourceType: null,
  captureSourceId: null,
  captureRoi: null
};

const CAPTURE_INTERVAL_MS = 15000;
const OCR_TEXT_LIMIT = 2000;
const OCR_PREVIEW_LIMIT = 140;

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

const buildEntryId = () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `event-${Date.now()}-${suffix}`;
};

const normalizeOcrText = (text: string) => text.replace(/\s+/g, " ").trim();

const buildOcrPreview = (text: string) => {
  if (text.length <= OCR_PREVIEW_LIMIT) {
    return text;
  }
  return `${text.slice(0, OCR_PREVIEW_LIMIT - 3)}...`;
};

const formatCaptureTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const App = () => {
  const [settings, setSettings] = useState<OverlaySettings | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [plan, setPlan] = useState<OverlayPlan | null>(null);
  const [lastValidPlan, setLastValidPlan] = useState<OverlayPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planWarning, setPlanWarning] = useState<string | null>(null);
  const [eventLog, setEventLog] = useState<EventLog>(emptyEventLog);
  const [eventLogError, setEventLogError] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState("Capture off.");
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureSources, setCaptureSources] = useState<CaptureSource[]>([]);
  const [captureSourcesError, setCaptureSourcesError] = useState<string | null>(null);
  const [lastOcrPreview, setLastOcrPreview] = useState<string | null>(null);
  const [lastCaptureAt, setLastCaptureAt] = useState<number | null>(null);
  const [lastOcrConfidence, setLastOcrConfidence] = useState<number | null>(null);
  const [roiSnapshot, setRoiSnapshot] = useState<CaptureSnapshotResult | null>(null);
  const [roiDraft, setRoiDraft] = useState<CaptureRoi | null>(null);
  const [roiError, setRoiError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [plannerNote, setPlannerNote] = useState("Ready.");
  const overlayAPI = window.overlayAPI;
  const defaultPlanMemo = useMemo(() => defaultPlan(), []);
  const captureInFlightRef = useRef(false);
  const skipNextCaptureRef = useRef(false);
  const roiImageRef = useRef<HTMLImageElement | null>(null);
  const roiDragRef = useRef<{ active: boolean; startX: number; startY: number }>({
    active: false,
    startX: 0,
    startY: 0
  });
  const loadCaptureSources = useCallback(async () => {
    if (!overlayAPI || typeof overlayAPI.listCaptureSources !== "function") {
      setCaptureSourcesError("Capture source API not available. Restart Electron.");
      setCaptureSources([]);
      return;
    }
    try {
      const sources = await overlayAPI.listCaptureSources();
      setCaptureSources(sources);
      setCaptureSourcesError(null);
    } catch (error: unknown) {
      setCaptureSourcesError(
        error instanceof Error ? error.message : "Failed to load capture sources."
      );
      setCaptureSources([]);
    }
  }, [overlayAPI]);

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

  useEffect(() => {
    if (!overlayAPI) {
      return;
    }
    loadCaptureSources().catch(() => undefined);
  }, [overlayAPI, loadCaptureSources]);

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

  const handleCaptureSourceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!settings) {
      return;
    }
    const value = event.target.value;
    if (!value) {
      saveSettings({
        ...settings,
        captureSourceId: null,
        captureSourceType: null,
        captureRoi: null
      });
      return;
    }
    const [type, ...rest] = value.split(":");
    const id = rest.join(":");
    if (!id || (type !== "display" && type !== "window")) {
      setCaptureError("Invalid capture source selected.");
      return;
    }
    setCaptureError(null);
    saveSettings({
      ...settings,
      captureSourceType: type as CaptureSourceType,
      captureSourceId: id,
      captureRoi: null
    });
  };

  const closeRoiModal = () => {
    setRoiSnapshot(null);
    setRoiDraft(null);
    setRoiError(null);
    roiDragRef.current.active = false;
  };

  const startRoiSelection = async () => {
    if (!settings?.captureSourceType || !settings.captureSourceId) {
      setCaptureError("Select a capture source before setting ROI.");
      return;
    }
    if (!overlayAPI || typeof overlayAPI.captureSnapshot !== "function") {
      setCaptureError("ROI snapshot API not available. Restart Electron.");
      return;
    }
    setCaptureError(null);
    setRoiError(null);
    setRoiDraft(null);
    try {
      const snapshot = await overlayAPI.captureSnapshot({
        type: settings.captureSourceType,
        id: settings.captureSourceId
      });
      setRoiSnapshot(snapshot);
    } catch (error: unknown) {
      setCaptureError(error instanceof Error ? error.message : "Failed to capture snapshot.");
    }
  };

  const saveRoi = async () => {
    if (!settings) {
      return;
    }
    if (!roiDraft) {
      setRoiError("Drag to select an ROI before saving.");
      return;
    }
    if (roiDraft.width < 0.01 || roiDraft.height < 0.01) {
      setRoiError("ROI is too small. Drag a larger region.");
      return;
    }
    setRoiError(null);
    await saveSettings({ ...settings, captureRoi: roiDraft });
    closeRoiModal();
  };

  const clearRoi = async () => {
    if (!settings) {
      return;
    }
    await saveSettings({ ...settings, captureRoi: null });
    setRoiError(null);
    closeRoiModal();
  };

  const getRoiNormalizedPoint = (clientX: number, clientY: number) => {
    const img = roiImageRef.current;
    if (!img) {
      return null;
    }
    const rect = img.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y))
    };
  };

  const handleRoiPointerDown = (event: React.PointerEvent) => {
    const point = getRoiNormalizedPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    roiDragRef.current = { active: true, startX: point.x, startY: point.y };
    setRoiDraft({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const handleRoiPointerMove = (event: React.PointerEvent) => {
    if (!roiDragRef.current.active) {
      return;
    }
    const point = getRoiNormalizedPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const startX = roiDragRef.current.startX;
    const startY = roiDragRef.current.startY;
    const x = Math.min(startX, point.x);
    const y = Math.min(startY, point.y);
    const width = Math.abs(point.x - startX);
    const height = Math.abs(point.y - startY);
    setRoiDraft({ x, y, width, height });
  };

  const handleRoiPointerUp = (event: React.PointerEvent) => {
    if (!roiDragRef.current.active) {
      return;
    }
    roiDragRef.current.active = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handleCaptureToggle = () => {
    if (!settings) {
      return;
    }
    if (!settings.captureEnabled) {
      if (!overlayAPI || typeof overlayAPI.captureAndProcess !== "function") {
        setCaptureError("Capture API not available. Restart Electron to load updated IPC handlers.");
        return;
      }
      if (!settings.captureSourceType || !settings.captureSourceId) {
        setCaptureError("Select a capture source before enabling capture.");
        return;
      }
      const confirmed = window.confirm(
        "Enable screen capture for OCR?\nCaptures are stored locally while enabled."
      );
      if (!confirmed) {
        return;
      }
      skipNextCaptureRef.current = true;
      captureOnce({
        type: settings.captureSourceType,
        id: settings.captureSourceId
      }).catch(() => undefined);
    }
    if (settings.captureEnabled) {
      overlayAPI?.stopCapture?.();
    }
    saveSettings({ ...settings, captureEnabled: !settings.captureEnabled });
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

  const persistEventLog = useCallback(async (next: EventLog) => {
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
  }, [overlayAPI]);

  const handleAddEventEntry = useCallback((entry: EventLogEntry) => {
    setEventLog((prev) => {
      const next = { ...prev, entries: [...prev.entries, entry] };
      persistEventLog(next).catch(() => undefined);
      return next;
    });
  }, [persistEventLog]);

  const captureOnce = useCallback(
    async (target: { id: string; type: CaptureSourceType } | null) => {
      if (captureInFlightRef.current) {
        return;
      }
      if (!overlayAPI || typeof overlayAPI.captureAndProcess !== "function") {
        setCaptureError("Capture API not available. Restart Electron to load updated IPC handlers.");
        return;
      }
      if (!target) {
        setCaptureError("Select a capture source before enabling capture.");
        return;
      }
      captureInFlightRef.current = true;
      setCaptureStatus("Capture running.");
      try {
        const result = await overlayAPI.captureAndProcess(target);
        if (!result) {
          setCaptureError("No screen sources available for capture.");
          return;
        }
        const normalized = normalizeOcrText(result.text);
        const trimmed = normalized.slice(0, OCR_TEXT_LIMIT);
        const preview = trimmed ? buildOcrPreview(trimmed) : "No text detected.";
        setLastOcrPreview(preview);
        setLastCaptureAt(result.capturedAt);
        setLastOcrConfidence(result.confidence);
        if (result.error) {
          setCaptureError(result.error);
        } else {
          setCaptureError(null);
        }
        const entry: EventLogEntry = {
          id: buildEntryId(),
          eventType: "ocr",
          timestamp: result.capturedAt,
          note: preview,
          data: {
            text: trimmed,
            confidence: result.confidence,
            capturePath: result.capturePath,
            sourceName: result.sourceName,
            capturedAt: result.capturedAt
          }
        };
        handleAddEventEntry(entry);
      } catch (error: unknown) {
        const detail =
          error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Capture failed.";
        setCaptureStatus("Capture error.");
        setCaptureError(detail);
        console.error("[capture] failed", error);
      } finally {
        captureInFlightRef.current = false;
      }
    },
    [handleAddEventEntry, overlayAPI]
  );

  useEffect(() => {
    if (!settings?.captureEnabled) {
      setCaptureStatus("Capture off.");
      setCaptureError(null);
      return;
    }
    if (!overlayAPI || typeof overlayAPI.captureAndProcess !== "function") {
      setCaptureStatus("Capture unavailable.");
      setCaptureError("Capture API not available. Restart Electron to load updated IPC handlers.");
      return;
    }
    const target =
      settings.captureSourceType && settings.captureSourceId
        ? { type: settings.captureSourceType, id: settings.captureSourceId }
        : null;

    if (skipNextCaptureRef.current) {
      skipNextCaptureRef.current = false;
    } else {
      captureOnce(target).catch(() => undefined);
    }
    const timer = setInterval(() => {
      captureOnce(target).catch(() => undefined);
    }, CAPTURE_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [
    captureOnce,
    overlayAPI,
    settings?.captureEnabled,
    settings?.captureSourceId,
    settings?.captureSourceType
  ]);

  const displaySources = useMemo(
    () => captureSources.filter((source) => source.type === "display"),
    [captureSources]
  );
  const windowSources = useMemo(
    () => captureSources.filter((source) => source.type === "window"),
    [captureSources]
  );
  const captureSourceValue =
    settings?.captureSourceId && settings?.captureSourceType
      ? `${settings.captureSourceType}:${settings.captureSourceId}`
      : "";

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
          <div className="control-group">
            <span className="label">Capture</span>
            <button
              type="button"
              className={settings?.captureEnabled ? "capture-button on" : "capture-button off"}
              onClick={handleCaptureToggle}
            >
              {settings?.captureEnabled ? "Disable" : "Enable"}
            </button>
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
          <div className="capture-panel">
            <h3>Capture OCR</h3>
            <p className="capture-status">{captureStatus}</p>
            {captureError && <p className="capture-error">{captureError}</p>}
            <p className="capture-meta">
              {lastCaptureAt
                ? `Last capture ${formatCaptureTime(lastCaptureAt)}`
                : "No captures yet."}
              {lastOcrConfidence !== null ? ` | Confidence ${lastOcrConfidence}%` : ""}
            </p>
            <p className={lastOcrPreview ? "capture-preview" : "capture-preview muted"}>
              {lastOcrPreview ?? "No OCR text yet."}
            </p>
            <p className="capture-meta">
              ROI: {settings?.captureRoi ? "set" : "not set"}{" "}
              <button type="button" onClick={() => startRoiSelection().catch(() => undefined)}>
                Set ROI
              </button>
              {settings?.captureRoi && (
                <button type="button" onClick={() => clearRoi().catch(() => undefined)}>
                  Clear ROI
                </button>
              )}
            </p>
            <div className="capture-source">
              <div className="capture-source-header">
                <span className="capture-source-label">Source</span>
                <button type="button" onClick={() => loadCaptureSources().catch(() => undefined)}>
                  Refresh
                </button>
              </div>
              <select value={captureSourceValue} onChange={handleCaptureSourceChange}>
                <option value="" disabled>
                  Choose window or display
                </option>
                {displaySources.length > 0 && (
                  <optgroup label="Displays">
                    {displaySources.map((source) => (
                      <option key={`display:${source.id}`} value={`display:${source.id}`}>
                        {source.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {windowSources.length > 0 && (
                  <optgroup label="Windows">
                    {windowSources.map((source) => (
                      <option key={`window:${source.id}`} value={`window:${source.id}`}>
                        {source.processName ? `${source.name} (${source.processName})` : source.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {captureSourcesError && <p className="capture-error">{captureSourcesError}</p>}
            </div>
          </div>
        </aside>
      </main>

      {roiSnapshot && (
        <div className="roi-modal" role="dialog" aria-modal="true">
          <div className="roi-modal-card">
            <div className="roi-modal-header">
              <strong>Select ROI</strong>
              <button type="button" onClick={closeRoiModal}>
                Close
              </button>
            </div>
            <p className="roi-modal-help">
              Drag on the screenshot to select the region to OCR (best: HUD/text area only).
            </p>
            {roiError && <p className="capture-error">{roiError}</p>}
            <div
              className="roi-canvas"
              onPointerDown={handleRoiPointerDown}
              onPointerMove={handleRoiPointerMove}
              onPointerUp={handleRoiPointerUp}
            >
              <img ref={roiImageRef} src={roiSnapshot.dataUrl} alt="ROI snapshot" />
              {roiDraft && roiDraft.width > 0 && roiDraft.height > 0 && (
                <div
                  className="roi-rect"
                  style={{
                    left: `${roiDraft.x * 100}%`,
                    top: `${roiDraft.y * 100}%`,
                    width: `${roiDraft.width * 100}%`,
                    height: `${roiDraft.height * 100}%`
                  }}
                />
              )}
            </div>
            <div className="roi-modal-actions">
              <button type="button" onClick={() => saveRoi().catch(() => undefined)}>
                Save ROI
              </button>
              <button type="button" onClick={() => clearRoi().catch(() => undefined)}>
                Clear ROI
              </button>
              <button type="button" onClick={closeRoiModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
