/**
 * ProfileEditor - Edit profile defaults and capabilities
 */

import React, { useEffect, useState, useRef } from "react";
import { Profile, Capability } from "../../types/profile";
import { StatusIndicator } from "../StatusIndicator";
import "./ProfileEditor.css";

export type ProfileEditorProps = {
  profileId?: string;
  onProfileUpdated?: (profile: Profile) => void;
};

const CAPABILITIES: { value: Capability; label: string; description: string }[] = [
  {
    value: "manual_inputs",
    label: "Manual Inputs",
    description: "Allows manual widget input and editing"
  },
  {
    value: "ocr_snapshot",
    label: "OCR Snapshot",
    description: "Enables screen capture and text recognition"
  },
  {
    value: "clipboard_parse",
    label: "Clipboard Parse",
    description: "Allows parsing data from clipboard"
  },
  { value: "log_import", label: "Log Import", description: "Enables importing log files" }
];

export const ProfileEditor: React.FC<ProfileEditorProps> = ({ profileId, onProfileUpdated }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [edited, setEdited] = useState<Partial<Profile> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refetch, setRefetch] = useState(0);
  const [lastSaveTime, setLastSaveTime] = useState(0);
  const apiRef = useRef(window.overlayAPI);

  // Force reload when profileId changes (switching profiles)
  useEffect(() => {
    setLoading(true);
    setEdited(null);
    setError(null);
    setStatusMessage("");
    if (apiRef.current) {
      apiRef.current.getActiveProfile().then((p) => {
        setProfile(p);
        setLoading(false);
      });
    }
  }, [profileId]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!apiRef.current) {
        setError("API not available");
        setLoading(false);
        return;
      }
      try {
        const active = await apiRef.current.getActiveProfile();
        
        // If profile changed, reset editing state and lastSaveTime to re-enable polling
        if (profile && active.id !== profile.id) {
          setEdited(null);
          setLastSaveTime(0);
        }
        
        setProfile(active);
        setEdited(null);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
        setLoading(false);
      }
    };
    loadProfile();
  }, [profileId, refetch]);

  // Expose a way to refetch when profile changes
  // Only poll if no edits are pending (edited === null)
  // Poll constantly so we catch profile switches immediately
  useEffect(() => {
    if (edited !== null) {
      // Don't poll while editing to avoid interrupting the user
      return;
    }

    const pollInterval = setInterval(() => {
      setRefetch(prev => prev + 1);
    }, 500);
    return () => clearInterval(pollInterval);
  }, [edited]);

  const current = edited || profile;

  const handleFieldBlur = async (field: keyof Profile, value: any) => {
    if (!profile) return;

    // Check if actually changed
    const profileValue = profile[field];
    const hasChanged = Array.isArray(value) 
      ? JSON.stringify(profileValue) !== JSON.stringify(value)
      : profileValue !== value;
    
    if (!hasChanged) {
      setEdited(null);
      return;
    }

    // Optimistic update - update local state immediately
    const updated = { ...profile, [field]: value };
    setProfile(updated);
    setEdited(null);
    setStatusMessage("Saving...");

    // Save in background
    if (apiRef.current) {
      try {
        const result = await apiRef.current.updateProfile(profile.id, { [field]: value });
        setProfile(result);
        setStatusMessage("Saved");
        if (onProfileUpdated) {
          onProfileUpdated(result);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
        setStatusMessage("");
        // Revert on error
        setProfile(profile);
      }
    }
  };

  const handleCapabilityChange = async (capability: Capability, enabled: boolean) => {
    if (!profile) return;

    const caps = profile.capabilities || [];
    const newCaps = enabled ? [...caps, capability] : caps.filter((c) => c !== capability);
    await handleFieldBlur("capabilities", newCaps);
  };

  if (loading || !profile) {
    return <div className="profile-editor loading">Loading profile...</div>;
  }

  return (
    <div className="profile-editor">
      <StatusIndicator 
        message={statusMessage || error} 
        type={error ? "error" : "success"}
        duration={error ? 3000 : 1500}
      />
      
      <h3>Profile Settings</h3>

      <div className="profile-editor-section">
        <label>Profile Name</label>
        <input
          type="text"
          value={current.name || ""}
          onChange={(e) => setEdited({ ...current, name: e.target.value })}
          onBlur={(e) => handleFieldBlur("name", e.target.value)}
          placeholder="Profile name"
        />
      </div>

      <div className="profile-editor-section">
        <label>Game Name (optional)</label>
        <input
          type="text"
          value={current.gameName || ""}
          onChange={(e) => setEdited({ ...current, gameName: e.target.value })}
          onBlur={(e) => handleFieldBlur("gameName", e.target.value)}
          placeholder="e.g., World of Warcraft"
        />
      </div>

      <div className="profile-editor-section">
        <label>Default Currency (optional)</label>
        <input
          type="text"
          value={current.currency || ""}
          onChange={(e) => setEdited({ ...current, currency: e.target.value })}
          onBlur={(e) => handleFieldBlur("currency", e.target.value)}
          placeholder="e.g., gold, silver, wemix"
        />
      </div>

      <div className="profile-editor-section">
        <label>Daily Reset Time (optional)</label>
        <input
          type="time"
          value={current.dailyResetTime || ""}
          onChange={(e) => setEdited({ ...current, dailyResetTime: e.target.value })}
          onBlur={(e) => handleFieldBlur("dailyResetTime", e.target.value)}
        />
      </div>

      <div className="profile-editor-section">
        <label>Capabilities</label>
        <div className="capabilities-list">
          {CAPABILITIES.map((cap) => (
            <div key={cap.value} className="capability-toggle">
              <input
                type="checkbox"
                id={`cap-${cap.value}`}
                checked={current.capabilities?.includes(cap.value) ?? false}
                onChange={(e) => handleCapabilityChange(cap.value, e.target.checked)}
              />
              <label htmlFor={`cap-${cap.value}`}>
                <div className="capability-label">{cap.label}</div>
                <div className="capability-description">{cap.description}</div>
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
