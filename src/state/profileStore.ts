/**
 * Profile Store - Manages profiles and scoping
 *
 * Responsibilities:
 * - CRUD operations on profiles
 * - Maintains exactly one active profile
 * - Profile scoping for plans, memory, and snapshots
 * - Emits change notifications for UI updates
 */

import { Profile, ProfileStore as ProfileStoreType, Capability } from "../types/profile";

export type ProfileStoreState = {
  profiles: Profile[];
  activeProfileId: string;
};

export type ProfileStoreListener = (state: ProfileStoreState) => void;

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `profile_${timestamp}_${random}`;
};

export class ProfileStore {
  private state: ProfileStoreState;
  private listeners: Set<ProfileStoreListener> = new Set();

  constructor(initialState?: ProfileStoreState) {
    if (initialState) {
      this.state = { ...initialState };
    } else {
      const defaultProfile: Profile = {
        id: generateId(),
        name: "Default",
        capabilities: ["manual_inputs", "ocr_snapshot", "clipboard_parse", "log_import"],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.state = {
        profiles: [defaultProfile],
        activeProfileId: defaultProfile.id
      };
    }
  }

  /**
   * Get current state
   */
  getState(): ProfileStoreState {
    return { ...this.state };
  }

  /**
   * Serialize to storage format
   */
  toStorageFormat(): ProfileStoreType {
    return {
      version: "1.0",
      profiles: this.state.profiles,
      activeProfileId: this.state.activeProfileId
    };
  }

  /**
   * Get active profile
   */
  getActiveProfile(): Profile {
    const profile = this.state.profiles.find((p) => p.id === this.state.activeProfileId);
    if (!profile) {
      throw new Error(`Active profile ${this.state.activeProfileId} not found`);
    }
    return profile;
  }

  /**
   * Get profile by ID
   */
  getProfile(id: string): Profile | undefined {
    return this.state.profiles.find((p) => p.id === id);
  }

  /**
   * Get all profiles
   */
  getProfiles(): Profile[] {
    return [...this.state.profiles];
  }

  /**
   * Create a new profile
   */
  createProfile(name: string, capabilities?: Capability[]): Profile {
    const profile: Profile = {
      id: generateId(),
      name,
      capabilities: capabilities ?? ["manual_inputs"],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.state.profiles.push(profile);
    this.notifyListeners();
    return profile;
  }

  /**
   * Update a profile
   */
  updateProfile(id: string, updates: Partial<Omit<Profile, "id" | "createdAt">>): Profile {
    const index = this.state.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`Profile ${id} not found`);
    }
    const updated: Profile = {
      ...this.state.profiles[index],
      ...updates,
      id, // preserve id
      createdAt: this.state.profiles[index].createdAt, // preserve createdAt
      updatedAt: Date.now()
    };
    this.state.profiles[index] = updated;
    this.notifyListeners();
    return updated;
  }

  /**
   * Delete a profile
   * If it's the active profile, activate the first remaining profile.
   */
  deleteProfile(id: string): void {
    const index = this.state.profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`Profile ${id} not found`);
    }
    if (this.state.profiles.length === 1) {
      throw new Error("Cannot delete the only profile");
    }
    this.state.profiles.splice(index, 1);

    if (this.state.activeProfileId === id) {
      this.state.activeProfileId = this.state.profiles[0].id;
    }
    this.notifyListeners();
  }

  /**
   * Set active profile
   */
  setActiveProfile(id: string): void {
    const profile = this.state.profiles.find((p) => p.id === id);
    if (!profile) {
      throw new Error(`Profile ${id} not found`);
    }
    this.state.activeProfileId = id;
    this.notifyListeners();
  }

  /**
   * Check if a capability is enabled in the active profile
   */
  hasCapability(capability: Capability): boolean {
    const active = this.getActiveProfile();
    return active.capabilities.includes(capability);
  }

  /**
   * Check if a capability is enabled in a specific profile
   */
  hasCapabilityInProfile(profileId: string, capability: Capability): boolean {
    const profile = this.getProfile(profileId);
    return profile?.capabilities.includes(capability) ?? false;
  }

  /**
   * Enable a capability in active profile
   */
  enableCapability(capability: Capability): Profile {
    const active = this.getActiveProfile();
    if (!active.capabilities.includes(capability)) {
      active.capabilities.push(capability);
      return this.updateProfile(active.id, { capabilities: active.capabilities });
    }
    return active;
  }

  /**
   * Disable a capability in active profile
   */
  disableCapability(capability: Capability): Profile {
    const active = this.getActiveProfile();
    const filtered = active.capabilities.filter((c) => c !== capability);
    if (filtered.length !== active.capabilities.length) {
      return this.updateProfile(active.id, { capabilities: filtered });
    }
    return active;
  }

  /**
   * Get profile defaults (currency, numberFormat, dailyResetTime)
   */
  getActiveProfileDefaults(): {
    currency?: string;
    numberFormat?: string;
    dailyResetTime?: string;
  } {
    const active = this.getActiveProfile();
    return {
      currency: active.currency,
      numberFormat: active.numberFormat,
      dailyResetTime: active.dailyResetTime
    };
  }

  /**
   * Subscribe to changes
   */
  subscribe(listener: ProfileStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => {
      listener(state);
    });
  }
}

export const createProfileStore = (initialState?: ProfileStoreState): ProfileStore => {
  return new ProfileStore(initialState);
};
