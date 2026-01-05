import { useEffect, useState } from 'react';

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ClockWidget() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="widget">
      <div className="widget-title">Clock</div>
      <div className="widget-content time">{formatTime(now)}</div>
    </div>
  );
}
