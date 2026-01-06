import { useEffect, useMemo, useState } from 'react';
import { execute, select } from '../lib/db';

interface TimerRecord {
  id: string;
  name: string;
  ends_at: number;
  created_at: number;
}

interface CounterRecord {
  id: string;
  name: string;
  value: number;
  created_at: number;
}

interface NoteRecord {
  id: string;
  content: string;
  created_at: number;
}

interface SpotSession {
  id: string;
  spot_name: string;
  character_level: number;
  exp_start: number;
  exp_end: number | null;
  exp_to_next_level: number | null;
  started_at: number;
  ended_at: number | null;
  duration_seconds: number | null;
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds < 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [];
  if (hrs) parts.push(`${hrs}h`);
  if (mins) parts.push(`${mins}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function expPerHour(expGained: number, durationSeconds: number) {
  if (durationSeconds <= 0) return 0;
  return expGained * (3600 / durationSeconds);
}

function id() {
  return crypto.randomUUID();
}

export function Phase1ManualData() {
  const [timers, setTimers] = useState<TimerRecord[]>([]);
  const [counters, setCounters] = useState<CounterRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [sessions, setSessions] = useState<SpotSession[]>([]);
  const [activeSession, setActiveSession] = useState<SpotSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const [newTimerName, setNewTimerName] = useState('');
  const [newTimerMinutes, setNewTimerMinutes] = useState(5);

  const [newCounterName, setNewCounterName] = useState('');

  const [newNoteContent, setNewNoteContent] = useState('');

  const [spotName, setSpotName] = useState('');
  const [characterLevel, setCharacterLevel] = useState<number>(1);
  const [expStart, setExpStart] = useState<number>(0);
  const [expEnd, setExpEnd] = useState<number | ''>('');
  const [expToNext, setExpToNext] = useState<number | ''>('');

  const [filterSpot, setFilterSpot] = useState('');
  const [sortDescending, setSortDescending] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [loadedTimers, loadedCounters, loadedNotes, loadedSessions] = await Promise.all([
          select<TimerRecord>('SELECT * FROM timers ORDER BY created_at DESC'),
          select<CounterRecord>('SELECT * FROM counters ORDER BY created_at DESC'),
          select<NoteRecord>('SELECT * FROM notes ORDER BY created_at DESC'),
          select<SpotSession>('SELECT * FROM spot_sessions ORDER BY started_at DESC'),
        ]);

        setTimers(loadedTimers);
        setCounters(loadedCounters);
        setNotes(loadedNotes);
        setSessions(loadedSessions);
        const active = loadedSessions.find((session) => session.ended_at === null) ?? null;
        setActiveSession(active);
      } catch (err) {
        console.error(err);
        setError('Failed to load data from the database. Please ensure SQL permissions are enabled.');
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  const addTimer = async () => {
    if (!newTimerName.trim() || newTimerMinutes <= 0) return;
    const endsAt = Date.now() + newTimerMinutes * 60 * 1000;
    const record: TimerRecord = {
      id: id(),
      name: newTimerName.trim(),
      ends_at: endsAt,
      created_at: Date.now(),
    };
    await execute('INSERT INTO timers (id, name, ends_at, created_at) VALUES (?, ?, ?, ?)', [
      record.id,
      record.name,
      record.ends_at,
      record.created_at,
    ]);
    setTimers((prev) => [record, ...prev]);
    setNewTimerName('');
  };

  const removeTimer = async (timerId: string) => {
    await execute('DELETE FROM timers WHERE id = ?', [timerId]);
    setTimers((prev) => prev.filter((t) => t.id !== timerId));
  };

  const addCounter = async () => {
    if (!newCounterName.trim()) return;
    const record: CounterRecord = {
      id: id(),
      name: newCounterName.trim(),
      value: 0,
      created_at: Date.now(),
    };
    await execute('INSERT INTO counters (id, name, value, created_at) VALUES (?, ?, ?, ?)', [
      record.id,
      record.name,
      record.value,
      record.created_at,
    ]);
    setCounters((prev) => [record, ...prev]);
    setNewCounterName('');
  };

  const updateCounter = async (counterId: string, nextValue: number) => {
    setCounters((prev) => prev.map((c) => (c.id === counterId ? { ...c, value: nextValue } : c)));
    await execute('UPDATE counters SET value = ? WHERE id = ?', [nextValue, counterId]);
  };

  const removeCounter = async (counterId: string) => {
    await execute('DELETE FROM counters WHERE id = ?', [counterId]);
    setCounters((prev) => prev.filter((c) => c.id !== counterId));
  };

  const addNote = async () => {
    if (!newNoteContent.trim()) return;
    const record: NoteRecord = {
      id: id(),
      content: newNoteContent.trim(),
      created_at: Date.now(),
    };
    await execute('INSERT INTO notes (id, content, created_at) VALUES (?, ?, ?)', [
      record.id,
      record.content,
      record.created_at,
    ]);
    setNotes((prev) => [record, ...prev]);
    setNewNoteContent('');
  };

  const removeNote = async (noteId: string) => {
    await execute('DELETE FROM notes WHERE id = ?', [noteId]);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
  };

  const startSession = async () => {
    if (!spotName.trim()) return;
    const record: SpotSession = {
      id: id(),
      spot_name: spotName.trim(),
      character_level: Number(characterLevel) || 1,
      exp_start: Number(expStart) || 0,
      exp_end: null,
      exp_to_next_level: expToNext === '' ? null : Number(expToNext),
      started_at: Date.now(),
      ended_at: null,
      duration_seconds: null,
    };
    await execute(
      'INSERT INTO spot_sessions (id, spot_name, character_level, exp_start, exp_end, exp_to_next_level, started_at, ended_at, duration_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        record.id,
        record.spot_name,
        record.character_level,
        record.exp_start,
        record.exp_end,
        record.exp_to_next_level,
        record.started_at,
        record.ended_at,
        record.duration_seconds,
      ],
    );
    setSessions((prev) => [record, ...prev]);
    setActiveSession(record);
    setExpEnd('');
  };

  const stopSession = async () => {
    if (!activeSession) return;
    const finalExpEnd = expEnd === '' ? activeSession.exp_start : Number(expEnd);
    const finalExpToNext = expToNext === '' ? null : Number(expToNext);
    const endedAt = Date.now();
    const durationSeconds = Math.max(1, Math.floor((endedAt - activeSession.started_at) / 1000));

    await execute(
      'UPDATE spot_sessions SET exp_end = ?, exp_to_next_level = ?, ended_at = ?, duration_seconds = ? WHERE id = ?',
      [finalExpEnd, finalExpToNext, endedAt, durationSeconds, activeSession.id],
    );

    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSession.id
          ? {
              ...session,
              exp_end: finalExpEnd,
              exp_to_next_level: finalExpToNext,
              ended_at: endedAt,
              duration_seconds: durationSeconds,
            }
          : session,
      ),
    );
    setActiveSession(null);
  };

  const expGained = useMemo(() => {
    if (!activeSession) return 0;
    const finalExp = expEnd === '' ? activeSession.exp_start : Number(expEnd);
    return Math.max(0, finalExp - activeSession.exp_start);
  }, [activeSession, expEnd]);

  const currentDuration = useMemo(() => {
    if (!activeSession) return 0;
    const endTime = activeSession.ended_at ?? now;
    return Math.max(1, Math.floor((endTime - activeSession.started_at) / 1000));
  }, [activeSession, now]);

  const expPerHourLive = activeSession ? expPerHour(expGained, currentDuration) : 0;

  const timeToLevelSeconds = useMemo(() => {
    if (!activeSession) return null;
    if (expToNext === '' || expPerHourLive <= 0) return null;
    const hours = Number(expToNext) / expPerHourLive;
    return Math.round(hours * 3600);
  }, [activeSession, expPerHourLive, expToNext]);

  const filteredSessions = useMemo(() => {
    const filtered = sessions.filter((s) =>
      s.spot_name.toLowerCase().includes(filterSpot.toLowerCase()),
    );
    const sorted = [...filtered].sort((a, b) => {
      const expA = a.exp_end ? a.exp_end - a.exp_start : 0;
      const expB = b.exp_end ? b.exp_end - b.exp_start : 0;
      const ephA = a.duration_seconds ? expPerHour(expA, a.duration_seconds) : 0;
      const ephB = b.duration_seconds ? expPerHour(expB, b.duration_seconds) : 0;
      return sortDescending ? ephB - ephA : ephA - ephB;
    });
    return sorted;
  }, [sessions, filterSpot, sortDescending]);

  const bestSpot = useMemo(() => {
    const recent = filteredSessions.slice(0, 20);
    return recent[0];
  }, [filteredSessions]);

  if (loading) return <div className="manual-screen">Loading manual data...</div>;

  return (
    <div className="manual-screen">
      <h1>Phase 1 / Manual Data</h1>
      {error && <div className="error-banner">{error}</div>}
      <div className="manual-grid">
        <div className="card">
          <div className="card-header">Clock &amp; Timers</div>
          <div className="card-body">
            <div className="clock-row">Current time: {new Date(now).toLocaleTimeString()}</div>
            <div className="inline-form">
              <input
                placeholder="Timer name"
                value={newTimerName}
                onChange={(e) => setNewTimerName(e.target.value)}
              />
              <input
                type="number"
                min={1}
                value={newTimerMinutes}
                onChange={(e) => setNewTimerMinutes(Number(e.target.value))}
              />
              <span>minutes</span>
              <button type="button" onClick={addTimer}>Add</button>
            </div>
            <ul className="list">
              {timers.map((timer) => {
                const remainingMs = timer.ends_at - now;
                const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
                return (
                  <li key={timer.id} className={remainingMs <= 0 ? 'expired' : ''}>
                    <div className="list-main">
                      <strong>{timer.name}</strong>
                      <span>{remainingMs <= 0 ? 'Expired' : formatDuration(remainingSeconds)}</span>
                    </div>
                    <button type="button" onClick={() => removeTimer(timer.id)}>Delete</button>
                  </li>
                );
              })}
              {!timers.length && <li className="muted">No timers yet.</li>}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Manual Counters</div>
          <div className="card-body">
            <div className="inline-form">
              <input
                placeholder="Counter name"
                value={newCounterName}
                onChange={(e) => setNewCounterName(e.target.value)}
              />
              <button type="button" onClick={addCounter}>Create</button>
            </div>
            <ul className="list">
              {counters.map((counter) => (
                <li key={counter.id}>
                  <div className="list-main">
                    <strong>{counter.name}</strong>
                    <span className="counter-value">{counter.value}</span>
                  </div>
                  <div className="button-row">
                    <button type="button" onClick={() => updateCounter(counter.id, counter.value - 1)}>-</button>
                    <button type="button" onClick={() => updateCounter(counter.id, counter.value + 1)}>+</button>
                    <button type="button" onClick={() => updateCounter(counter.id, 0)}>Reset</button>
                    <button type="button" onClick={() => removeCounter(counter.id)}>Delete</button>
                  </div>
                </li>
              ))}
              {!counters.length && <li className="muted">No counters yet.</li>}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Quick Notes</div>
          <div className="card-body">
            <textarea
              placeholder="Add a note"
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
            />
            <div className="button-row end">
              <button type="button" onClick={addNote}>Save Note</button>
            </div>
            <ul className="list">
              {notes.map((note) => (
                <li key={note.id}>
                  <div className="list-main">
                    <span>{note.content}</span>
                    <small>{formatTimestamp(note.created_at)}</small>
                  </div>
                  <button type="button" onClick={() => removeNote(note.id)}>Delete</button>
                </li>
              ))}
              {!notes.length && <li className="muted">No notes yet.</li>}
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Spot Session Tracker</div>
          <div className="card-body">
            {!activeSession ? (
              <div className="form-grid">
                <label>
                  Spot Name
                  <input value={spotName} onChange={(e) => setSpotName(e.target.value)} />
                </label>
                <label>
                  Character Level
                  <input
                    type="number"
                    min={1}
                    value={characterLevel}
                    onChange={(e) => setCharacterLevel(Number(e.target.value))}
                  />
                </label>
                <label>
                  EXP Start
                  <input
                    type="number"
                    min={0}
                    value={expStart}
                    onChange={(e) => setExpStart(Number(e.target.value))}
                  />
                </label>
                <label>
                  EXP to next level (optional)
                  <input
                    type="number"
                    min={0}
                    value={expToNext}
                    onChange={(e) => setExpToNext(e.target.value === '' ? '' : Number(e.target.value))}
                  />
                </label>
                <div className="button-row">
                  <button type="button" onClick={startSession}>Start Session</button>
                </div>
              </div>
            ) : (
              <div className="active-session">
                <div className="info">
                  <div><strong>Spot:</strong> {activeSession.spot_name}</div>
                  <div><strong>Level:</strong> {activeSession.character_level}</div>
                  <div><strong>Started:</strong> {formatTimestamp(activeSession.started_at)}</div>
                </div>
                <div className="metrics">
                  <div><strong>Duration:</strong> {formatDuration(currentDuration)}</div>
                  <div><strong>EXP gained:</strong> {expGained}</div>
                  <div><strong>EXP/hr:</strong> {expPerHourLive.toFixed(1)}</div>
                  <div>
                    <strong>Time to level:</strong>{' '}
                    {timeToLevelSeconds ? formatDuration(timeToLevelSeconds) : '—'}
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    EXP End
                    <input
                      type="number"
                      value={expEnd}
                      onChange={(e) => setExpEnd(e.target.value === '' ? '' : Number(e.target.value))}
                    />
                  </label>
                  <label>
                    EXP to next level (optional)
                    <input
                      type="number"
                      value={expToNext}
                      onChange={(e) => setExpToNext(e.target.value === '' ? '' : Number(e.target.value))}
                    />
                  </label>
                  <div className="button-row">
                    <button type="button" onClick={stopSession}>Stop Session</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card full-width">
          <div className="card-header">Session History &amp; Analytics</div>
          <div className="card-body">
            <div className="history-controls">
              <input
                placeholder="Filter by spot name"
                value={filterSpot}
                onChange={(e) => setFilterSpot(e.target.value)}
              />
              <button type="button" onClick={() => setSortDescending((v) => !v)}>
                Sort by EXP/hr {sortDescending ? '▼' : '▲'}
              </button>
            </div>
            {bestSpot && bestSpot.duration_seconds && bestSpot.exp_end !== null && (
              <div className="best-spot">
                <strong>Best spot (last 20):</strong> {bestSpot.spot_name} | EXP/hr:{' '}
                {expPerHour(bestSpot.exp_end - bestSpot.exp_start, bestSpot.duration_seconds).toFixed(1)}
              </div>
            )}
            <div className="table-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Spot</th>
                    <th>Level</th>
                    <th>EXP Start</th>
                    <th>EXP End</th>
                    <th>Duration</th>
                    <th>EXP Gained</th>
                    <th>EXP/hr</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.map((session) => {
                    const gained = session.exp_end ? session.exp_end - session.exp_start : 0;
                    const eph = session.duration_seconds ? expPerHour(gained, session.duration_seconds) : 0;
                    return (
                      <tr key={session.id}>
                        <td>{formatTimestamp(session.started_at)}</td>
                        <td>{session.spot_name}</td>
                        <td>{session.character_level}</td>
                        <td>{session.exp_start}</td>
                        <td>{session.exp_end ?? '—'}</td>
                        <td>{formatDuration(session.duration_seconds)}</td>
                        <td>{gained}</td>
                        <td>{eph.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                  {!filteredSessions.length && (
                    <tr>
                      <td colSpan={8} className="muted">No sessions logged.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
