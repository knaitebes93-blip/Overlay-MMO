import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Spot, SpotRate } from '../types';

const WINDOW_MINUTES = 30;

export function ExpTracker() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [activeSpotId, setActiveSpotId] = useState<string>('');
  const [newSpotName, setNewSpotName] = useState('');
  const [samplingInterval, setSamplingInterval] = useState<number>(10);
  const [manualLevel, setManualLevel] = useState<number>(1);
  const [manualExp, setManualExp] = useState<number>(0);
  const [rates, setRates] = useState<SpotRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [samplerRunning, setSamplerRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSpot = useMemo(
    () => spots.find((s) => s.id === activeSpotId),
    [spots, activeSpotId],
  );

  const loadInitial = async () => {
    try {
      const [loadedSpots, interval, active, running] = await Promise.all([
        invoke<Spot[]>('list_spots'),
        invoke<number>('get_sampling_interval_sec'),
        invoke<Spot | null>('get_active_spot'),
        invoke<boolean>('is_sampler_running'),
      ]);
      setSpots(loadedSpots);
      setSamplingInterval(interval);
      setActiveSpotId(active?.id ?? '');
      setSamplerRunning(running);
      setError(null);
    } catch (err) {
      console.error(err);
      setError('Failed to load EXP tracker state.');
    } finally {
      setLoading(false);
    }
  };

  const refreshRates = async () => {
    try {
      const data = await invoke<SpotRate[]>('list_spot_rates', { window_minutes: WINDOW_MINUTES });
      setRates(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load spot rates');
    }
  };

  useEffect(() => {
    loadInitial();
    refreshRates();
  }, []);

  useEffect(() => {
    if (!samplerRunning) return undefined;
    const id = setInterval(() => {
      refreshRates();
    }, 8000);
    return () => clearInterval(id);
  }, [samplerRunning]);

  const createSpot = async () => {
    if (!newSpotName.trim()) return;
    const created = await invoke<Spot>('upsert_spot', { name: newSpotName.trim() });
    setSpots((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
    setActiveSpotId(created.id);
    await invoke('set_active_spot', { spot_id: created.id });
    setNewSpotName('');
    refreshRates();
  };

  const selectSpot = async (spotId: string) => {
    setActiveSpotId(spotId);
    await invoke('set_active_spot', { spot_id: spotId });
  };

  const saveInterval = async () => {
    await invoke('set_sampling_interval_sec', { value: Number(samplingInterval) || 1 });
  };

  const updateManualValues = async () => {
    await invoke('set_manual_values', {
      level: Number(manualLevel) || 1,
      exp_percent: Number(manualExp) || 0,
    });
  };

  const startSampler = async () => {
    await invoke('start_sampler');
    setSamplerRunning(true);
  };

  const stopSampler = async () => {
    await invoke('stop_sampler');
    setSamplerRunning(false);
  };

  return (
    <div className="exp-tracker">
      <div className="exp-header">
        <h2>EXP Tracker</h2>
        <p>Passive sampling of EXP%/hour per spot. Window: last {WINDOW_MINUTES} minutes.</p>
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="exp-grid">
          <div className="exp-card">
            <h3>Spots</h3>
            <div className="form-row">
              <input
                placeholder="New spot name"
                value={newSpotName}
                onChange={(e) => setNewSpotName(e.target.value)}
              />
              <button type="button" onClick={createSpot}>Create/Select</button>
            </div>
            <select
              value={activeSpotId}
              onChange={(e) => selectSpot(e.target.value)}
              className="full-width"
            >
              <option value="">-- Select active spot --</option>
              {spots.map((spot) => (
                <option key={spot.id} value={spot.id}>
                  {spot.name}
                </option>
              ))}
            </select>
            <p className="muted">Active spot: {activeSpot?.name ?? 'None selected'}</p>
          </div>

          <div className="exp-card">
            <h3>Sampling</h3>
            <div className="form-row">
              <label>
                Interval (seconds)
                <input
                  type="number"
                  min={1}
                  value={samplingInterval}
                  onChange={(e) => setSamplingInterval(Number(e.target.value) || 1)}
                />
              </label>
              <button type="button" onClick={saveInterval}>Save</button>
            </div>
            <div className="form-row sampler-row">
              <button type="button" onClick={startSampler} disabled={samplerRunning || !activeSpotId}>
                Start sampler
              </button>
              <button type="button" onClick={stopSampler} disabled={!samplerRunning}>
                Stop sampler
              </button>
              <span className={`pill ${samplerRunning ? 'pill-on' : 'pill-off'}`}>
                {samplerRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
          </div>

          <div className="exp-card">
            <h3>Manual values</h3>
            <p className="muted">Use this until automated reading is available.</p>
            <div className="form-row">
              <label>
                Level
                <input
                  type="number"
                  min={1}
                  value={manualLevel}
                  onChange={(e) => setManualLevel(Number(e.target.value) || 1)}
                />
              </label>
              <label>
                EXP %
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={manualExp}
                  onChange={(e) => setManualExp(Number(e.target.value) || 0)}
                />
              </label>
            </div>
            <button type="button" onClick={updateManualValues} className="full-width">
              Update values
            </button>
          </div>
        </div>
      )}

      <div className="exp-card">
        <div className="table-header">
          <h3>Top spots (EXP%/h)</h3>
          <div className="form-row">
            <button type="button" onClick={refreshRates}>Refresh</button>
          </div>
        </div>
        {rates.length === 0 ? (
          <p className="muted">No data yet. Start sampling and provide manual values.</p>
        ) : (
          <table className="exp-table">
            <thead>
              <tr>
                <th>Spot</th>
                <th>EXP%/hour</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.spot_id}>
                  <td>{rate.spot_name}</td>
                  <td>{rate.exp_per_hour.toFixed(2)}</td>
                  <td>{rate.sample_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
