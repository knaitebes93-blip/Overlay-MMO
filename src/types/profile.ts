/**
 * Profile Types - Overlay configuration and capabilities
 *
 * Profiles represent a contextual configuration for the overlay,
 * scoping plans, memory, and data sources per profile.
 */

export type Capability =
  | "manual_inputs"
  | "ocr_snapshot"
  | "clipboard_parse"
  | "log_import";

export type Profile = {
  id: string;
  name: string;
  gameName?: string;
  currency?: string;
  numberFormat?: string;
  dailyResetTime?: string; // "HH:mm" local time
  capabilities: Capability[];
  createdAt: number;
  updatedAt: number;
};

export type ProfileStore = {
  version: "1.0";
  profiles: Profile[];
  activeProfileId: string;
};
