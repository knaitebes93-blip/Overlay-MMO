/**
 * StatusIndicator - Reusable status message component
 * Shows a small square indicator in top-left that appears and disappears automatically
 */

import React, { useEffect, useState } from "react";
import "./StatusIndicator.css";

export type StatusType = "success" | "error" | "info" | "warning";

export type StatusIndicatorProps = {
  message?: string;
  type?: StatusType;
  duration?: number; // ms before auto-hide (0 = no auto-hide)
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  message,
  type = "info",
  duration = 2000
}) => {
  const [visible, setVisible] = useState(!!message);

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }

    setVisible(true);
    if (duration > 0) {
      const timer = setTimeout(() => setVisible(false), duration);
      return () => clearTimeout(timer);
    }
  }, [message, duration]);

  if (!visible || !message) return null;

  return (
    <div className={`status-indicator status-${type}`} title={message}>
      <div className="status-dot"></div>
      {message && <span className="status-text">{message}</span>}
    </div>
  );
};
