export type IntentType = "timer" | "tracker" | "roi_panel" | "table" | "notes" | "alert";

const intentRules: Array<{ type: IntentType; match: (message: string) => boolean }> = [
  {
    type: "timer",
    match: (message) =>
      ["timer", "cooldown", "respawn", "cd"].some((token) => message.includes(token))
  },
  {
    type: "tracker",
    match: (message) =>
      /xp\/h|exp\/h|per hour|rate|\/h/.test(message)
  },
  {
    type: "roi_panel",
    match: (message) =>
      ["roi", "profit", "margin", "break-even", "fees", "fee"].some((token) =>
        message.includes(token)
      )
  },
  {
    type: "table",
    match: (message) =>
      ["table", "list", "watchlist", "market"].some((token) => message.includes(token))
  },
  {
    type: "notes",
    match: (message) =>
      ["note", "notes", "checklist", "todo", "text:"].some((token) =>
        message.includes(token)
      )
  },
  {
    type: "alert",
    match: (message) => ["alert", "notify"].some((token) => message.includes(token))
  }
];

export const detectIntents = (message: string): IntentType[] => {
  const normalized = message.toLowerCase();
  const intents: IntentType[] = [];
  const seen = new Set<IntentType>();

  for (const rule of intentRules) {
    if (rule.match(normalized) && !seen.has(rule.type)) {
      intents.push(rule.type);
      seen.add(rule.type);
    }
    if (intents.length >= 2) {
      break;
    }
  }

  if (intents.length === 0) {
    intents.push("notes");
  }

  return intents;
};
