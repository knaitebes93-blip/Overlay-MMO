/**
 * Capability Requirements - Define and enforce data source requirements for widgets
 */

import { Capability } from "../types/profile";
import { IntentType } from "./intent";

export type CapabilityRequirement = {
  capability: Capability;
  reason: string;
};

/**
 * Map intent types to required capabilities
 */
export const getCapabilitiesForIntent = (intent: IntentType): CapabilityRequirement[] => {
  switch (intent) {
    case "timer":
    case "text":
    case "counter":
    case "roi_panel":
      // Basic widgets don't require special capabilities
      return [];
    case "tracker":
    case "table":
      // These widgets support manual input
      return [{ capability: "manual_inputs", reason: "Widget accepts manual input" }];
    case "alert":
    case "notes":
    default:
      return [{ capability: "manual_inputs", reason: "Notes widget requires user input" }];
  }
};

/**
 * Check if a set of capabilities satisfies requirements
 */
export const satisfiesCapabilities = (
  available: Capability[],
  required: CapabilityRequirement[]
): boolean => {
  const availableSet = new Set(available);
  return required.every((req) => availableSet.has(req.capability));
};

/**
 * Get missing capabilities
 */
export const getMissingCapabilities = (
  available: Capability[],
  required: CapabilityRequirement[]
): CapabilityRequirement[] => {
  const availableSet = new Set(available);
  return required.filter((req) => !availableSet.has(req.capability));
};
