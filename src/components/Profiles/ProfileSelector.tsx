/**
 * ProfileSelector - Minimal profile selection UI for Inspector panel
 *
 * Allows users to:
 * - View active profile
 * - Switch between profiles
 * - Create new profile
 * - Delete profile (with confirmation)
 */

import React, { useEffect, useState, useRef } from "react";
import { Profile } from "../../types/profile";
import "./ProfileSelector.css";

export type ProfileSelectorProps = {
  onProfileChanged?: (profile: Profile) => void;
};

export const ProfileSelector: React.FC<ProfileSelectorProps> = ({ onProfileChanged }) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetch, setRefetch] = useState(0);
  const apiRef = useRef(window.overlayAPI);

  const loadProfiles = async () => {
    if (!apiRef.current) {
      setError("API not available");
      setLoading(false);
      return;
    }
    try {
      const list = await apiRef.current.listProfiles();
      setProfiles(list);
      const active = await apiRef.current.getActiveProfile();
      setActiveProfile(active);
      setLoading(false);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load profiles";
      console.error("[ProfileSelector] Error loading profiles:", message);
      setError(message);
      setLoading(false);
    }
  };

  // Load profiles on mount and when refetch changes
  useEffect(() => {
    loadProfiles();
  }, [refetch]);

  // Poll for changes every 500ms so ProfileEditor also updates
  // But stop polling if user is creating a new profile
  useEffect(() => {
    if (showCreate) {
      return; // Don't poll while user is creating
    }
    const pollInterval = setInterval(() => {
      setRefetch(prev => prev + 1);
    }, 500);
    return () => clearInterval(pollInterval);
  }, [showCreate]);

  const handleSelectProfile = async (profile: Profile) => {
    try {
      const updated = await apiRef.current!.setActiveProfile(profile.id);
      setActiveProfile(updated);
      if (onProfileChanged) {
        onProfileChanged(updated);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch profile");
    }
  };

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) {
      setError("Profile name cannot be empty");
      return;
    }

    try {
      const profile = await apiRef.current!.createProfile(newProfileName);
      setProfiles([...profiles, profile]);
      setNewProfileName("");
      setShowCreate(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    }
  };

  const handleDeleteProfile = async (profile: Profile) => {
    if (profiles.length === 1) {
      setError("Cannot delete the only profile");
      return;
    }

    if (!window.confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await apiRef.current!.deleteProfile(profile.id);
      const updated = profiles.filter((p) => p.id !== profile.id);
      setProfiles(updated);

      // If we deleted the active profile, the server switches to another one
      if (activeProfile?.id === profile.id) {
        const newActive = await apiRef.current!.getActiveProfile();
        setActiveProfile(newActive);
        if (onProfileChanged) {
          onProfileChanged(newActive);
        }
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete profile");
    }
  };

  if (loading) {
    return <div className="profile-selector loading">Loading profiles...</div>;
  }

  return (
    <div className="profile-selector">
      <div className="profile-selector-header">
        <h3>Profiles</h3>
        <button
          className="profile-btn-new"
          onClick={() => setShowCreate(!showCreate)}
          title="Create new profile"
        >
          +
        </button>
      </div>

      {error && <div className="profile-error">{error}</div>}

      {showCreate && (
        <div className="profile-create">
          <input
            type="text"
            placeholder="Profile name"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateProfile();
            }}
            autoFocus
          />
          <button onClick={handleCreateProfile} className="profile-btn-create">
            Create
          </button>
          <button onClick={() => setShowCreate(false)} className="profile-btn-cancel">
            Cancel
          </button>
        </div>
      )}

      <div className="profile-list">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className={`profile-item ${activeProfile?.id === profile.id ? "active" : ""}`}
            onClick={() => handleSelectProfile(profile)}
          >
            <div className="profile-item-info">
              <div className="profile-item-name">
                {profile.name}
              </div>
              {profile.gameName && <div className="profile-item-game">{profile.gameName}</div>}
              {profile.currency && (
                <div className="profile-item-meta">Currency: {profile.currency}</div>
              )}
              <div className="profile-item-capabilities">
                {profile.capabilities.map((cap) => (
                  <span key={cap} className="capability-badge">
                    {cap}
                  </span>
                ))}
              </div>
            </div>
            <button
              className="profile-btn-delete"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteProfile(profile);
              }}
              title="Delete profile"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {profiles.length === 0 && <div className="profile-empty">No profiles available</div>}
    </div>
  );
};
