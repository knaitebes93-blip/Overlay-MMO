import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Rnd } from 'react-rnd';
import { ClockWidget } from './components/ClockWidget';
import { StatusWidget } from './components/StatusWidget';
import type { MonitorInfo, OverlayMode, ProfileData, WidgetRect, WidgetType } from './types';

interface AppProps {
  windowLabel: string;
}

interface WidgetEntry {
  data: WidgetRect;
  content: JSX.Element;
}

const WIDGET_FACTORY: Record<WidgetType, () => JSX.Element> = {
  clock: () => <ClockWidget />, 
  status: () => <StatusWidget />, 
};

function toPixels(rect: WidgetRect, monitor?: MonitorInfo) {
  if (!monitor) return { width: 150, height: 80, x: 50, y: 50 };
  return {
    width: Math.max(40, rect.width * monitor.width),
    height: Math.max(40, rect.height * monitor.height),
    x: rect.x * monitor.width,
    y: rect.y * monitor.height,
  };
}

function clampRelative(value: number) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function buildDefaultProfile(monitors: MonitorInfo[]): ProfileData {
  const first = monitors[0];
  return {
    selectedMonitorId: first?.id ?? 'unassigned',
    widgets: [
      { id: 'clock', type: 'clock', x: 0.05, y: 0.05, width: 0.12, height: 0.1 },
      { id: 'status', type: 'status', x: 0.25, y: 0.05, width: 0.18, height: 0.12 },
    ],
  };
}

function OverlayView() {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [profileName, setProfileName] = useState('example');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [mode, setMode] = useState<OverlayMode>('edit');
  const appWindow = getCurrentWindow();

  const selectedMonitor = useMemo(() =>
    monitors.find((m) => m.id === profile?.selectedMonitorId),
  [monitors, profile?.selectedMonitorId]);

  const widgets: WidgetEntry[] = useMemo(() =>
    (profile?.widgets ?? []).map((entry) => ({
      data: entry,
      content: WIDGET_FACTORY[entry.type]?.() ?? <div className="widget">Unknown widget</div>,
    })),
  [profile?.widgets]);

  useEffect(() => {
    const unlistenMode = listen<{ mode: OverlayMode }>('set-mode', (event) => {
      setMode(event.payload.mode);
    });
    const unlistenProfile = listen<ProfileData>('apply-profile', (event) => {
      setProfile(event.payload);
    });
    const unlistenMonitor = listen<{ monitorId: string }>('select-monitor', (event) => {
      setProfile((prev) => (prev ? { ...prev, selectedMonitorId: event.payload.monitorId } : prev));
    });
    const unlistenRequest = listen('request-profile', () => {
      if (profile) {
        emitTo('settings', 'apply-profile', profile).catch(() => {});
      }
    });

    return () => {
      unlistenMode.then((f) => f());
      unlistenProfile.then((f) => f());
      unlistenMonitor.then((f) => f());
      unlistenRequest.then((f) => f());
    };
  }, [profile]);

  useEffect(() => {
    invoke<MonitorInfo[]>('list_monitors').then((list) => {
      setMonitors(list);
      setProfile((current) => current ?? buildDefaultProfile(list));
    }).catch((err) => console.error('Failed to list monitors', err));
  }, []);

  useEffect(() => {
    if (!selectedMonitor) return;
    const { width, height, x, y } = selectedMonitor;
    appWindow.setSize(new LogicalSize(width, height)).catch(console.error);
    appWindow.setPosition(new LogicalPosition(x, y)).catch(console.error);
    appWindow.setAlwaysOnTop(true).catch(console.error);
  }, [selectedMonitor]);

  useEffect(() => {
    appWindow.setIgnoreCursorEvents(mode === 'run').catch(console.error);
  }, [mode]);

  const applyWidgetChange = (id: string, next: Partial<WidgetRect>) => {
    if (!selectedMonitor) return;
    setProfile((prev) => {
      if (!prev) return prev;
      const widgets = prev.widgets.map((w) =>
        w.id === id ? { ...w, ...next } : w,
      );
      return { ...prev, widgets };
    });
  };

  const handleDragResize = (id: string, x: number, y: number, width: number, height: number) => {
    if (!selectedMonitor) return;
    applyWidgetChange(id, {
      x: clampRelative(x / selectedMonitor.width),
      y: clampRelative(y / selectedMonitor.height),
      width: clampRelative(width / selectedMonitor.width),
      height: clampRelative(height / selectedMonitor.height),
    });
  };

  const loadProfile = async () => {
    try {
      const loaded = await invoke<ProfileData>('read_profile', { profileName });
      setProfile(loaded);
    } catch (error) {
      console.error('Failed to load profile', error);
    }
  };

  const saveProfile = async () => {
    try {
      const payload: ProfileData = profile ?? buildDefaultProfile(monitors);
      await invoke('write_profile', { profileName, data: payload });
    } catch (error) {
      console.error('Failed to save profile', error);
    }
  };

  const addWidget = (type: WidgetType) => {
    if (!profile) return;
    const id = `${type}-${Date.now()}`;
    setProfile({
      ...profile,
      widgets: [...profile.widgets, { id, type, x: 0.1, y: 0.2, width: 0.15, height: 0.1 }],
    });
  };

  const openSettings = () => {
    const existing = WebviewWindow.getByLabel('settings');
    if (existing) {
      existing.setFocus().catch(console.error);
      return;
    }
    new WebviewWindow('settings', {
      url: '/',
      title: 'Overlay Settings',
      width: 500,
      height: 520,
      resizable: true,
      visible: true,
    });
  };

  const switchMode = (next: OverlayMode) => {
    setMode(next);
    emitTo('settings', 'mode-updated', { mode: next }).catch(() => {});
  };

  return (
    <div className={`overlay-root ${mode}`}>
      <div className="toolbar">
        <div className="toolbar-left">
          <button type="button" onClick={() => switchMode(mode === 'edit' ? 'run' : 'edit')}>
            Mode: {mode === 'edit' ? 'Edit' : 'Run'}
          </button>
          <button type="button" onClick={openSettings}>Settings</button>
        </div>
        <div className="toolbar-middle">
          <label>
            Profile:
            <input value={profileName} onChange={(e) => setProfileName(e.target.value)} />
          </label>
          <button type="button" onClick={loadProfile}>Load</button>
          <button type="button" onClick={saveProfile}>Save</button>
        </div>
        <div className="toolbar-right">
          <button type="button" onClick={() => addWidget('clock')}>Add Clock</button>
          <button type="button" onClick={() => addWidget('status')}>Add Status</button>
          <span className="monitor-label">Monitor: {selectedMonitor?.name ?? selectedMonitor?.id ?? 'N/A'}</span>
        </div>
      </div>
      <div className="overlay-stage" style={{ width: selectedMonitor?.width ?? '100%', height: selectedMonitor?.height ?? '100%' }}>
        {widgets.map(({ data }) => {
          const absolute = toPixels(data, selectedMonitor);
          return (
            <Rnd
              key={data.id}
              bounds="parent"
              size={{ width: absolute.width, height: absolute.height }}
              position={{ x: absolute.x, y: absolute.y }}
              onDragStop={(e, d) => handleDragResize(data.id, d.x, d.y, absolute.width, absolute.height)}
              onResizeStop={(e, direction, ref, delta, position) => {
                const width = ref.offsetWidth;
                const height = ref.offsetHeight;
                handleDragResize(data.id, position.x, position.y, width, height);
              }}
              enableResizing={mode === 'edit'}
              disableDragging={mode !== 'edit'}
              className={`widget-frame ${mode === 'edit' ? 'with-handles' : ''}`}
            >
              {WIDGET_FACTORY[data.type]?.() ?? <div className="widget">Unknown widget</div>}
            </Rnd>
          );
        })}
      </div>
    </div>
  );
}

function SettingsView() {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [currentMonitorId, setCurrentMonitorId] = useState<string>('');
  const [mode, setMode] = useState<OverlayMode>('edit');

  useEffect(() => {
    invoke<MonitorInfo[]>('list_monitors').then(setMonitors).catch(console.error);
    emitTo('overlay', 'request-profile', {}).catch(() => {});
  }, []);

  useEffect(() => {
    const unlistenMode = listen<{ mode: OverlayMode }>('mode-updated', (event) => setMode(event.payload.mode));
    const unlistenProfile = listen<ProfileData>('apply-profile', (event) => setCurrentMonitorId(event.payload.selectedMonitorId));

    return () => {
      unlistenMode.then((f) => f());
      unlistenProfile.then((f) => f());
    };
  }, []);

  const selectMonitor = (monitorId: string) => {
    setCurrentMonitorId(monitorId);
    emitTo('overlay', 'select-monitor', { monitorId }).catch(console.error);
  };

  const loadProfile = async (profileName: string) => {
    try {
      const profile = await invoke<ProfileData>('read_profile', { profileName });
      setCurrentMonitorId(profile.selectedMonitorId);
      emitTo('overlay', 'apply-profile', profile).catch(console.error);
    } catch (error) {
      console.error('Failed to load profile', error);
    }
  };

  const enforceMode = (next: OverlayMode) => {
    setMode(next);
    emitTo('overlay', 'set-mode', { mode: next }).catch(console.error);
  };

  return (
    <div className="settings-root">
      <h1>Overlay Settings</h1>
      <div className="settings-section">
        <h2>Monitors</h2>
        <ul>
          {monitors.map((monitor) => (
            <li key={monitor.id} className={monitor.id === currentMonitorId ? 'selected' : ''}>
              <div className="monitor-row">
                <div>
                  <strong>{monitor.name ?? 'Unnamed Monitor'}</strong> ({monitor.id})
                </div>
                <div>Bounds: x={monitor.x}, y={monitor.y}, w={monitor.width}, h={monitor.height}</div>
              </div>
              <button type="button" onClick={() => selectMonitor(monitor.id)}>Use this monitor</button>
            </li>
          ))}
        </ul>
      </div>
      <div className="settings-section">
        <h2>Profiles</h2>
        <div className="profile-quick">
          <button type="button" onClick={() => loadProfile('example')}>Load example</button>
        </div>
      </div>
      <div className="settings-section">
        <h2>Overlay Mode</h2>
        <p>Current mode: {mode}</p>
        <div className="mode-buttons">
          <button type="button" onClick={() => enforceMode('edit')}>Switch to Edit</button>
          <button type="button" onClick={() => enforceMode('run')}>Switch to Run</button>
        </div>
      </div>
    </div>
  );
}

export default function App({ windowLabel }: AppProps) {
  return windowLabel === 'settings' ? <SettingsView /> : <OverlayView />;
}
