export type TimerExtraction = {
  name?: string;
  durationSeconds?: number;
};

export type TrackerExtraction = {
  metricName?: string;
  startValue?: number;
  endValue?: number;
  durationMinutes?: number;
};

export type RoiExtraction = {
  cost?: number;
  revenue?: number;
  feePercent?: number;
  feeFixed?: number;
};

export type TableExtraction = {
  columns?: string;
};

export type NotesExtraction = {
  text?: string;
};

const durationRegex = () =>
  /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/gi;

const parseNumber = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseDurationToSeconds = (input: string): number | null => {
  let totalSeconds = 0;
  let matched = false;
  const matches = input.matchAll(durationRegex());
  for (const match of matches) {
    const amount = parseNumber(match[1]);
    if (amount === undefined) {
      continue;
    }
    const unit = match[2].toLowerCase();
    matched = true;
    if (unit.startsWith("h")) {
      totalSeconds += amount * 3600;
    } else if (unit.startsWith("m")) {
      totalSeconds += amount * 60;
    } else {
      totalSeconds += amount;
    }
  }
  if (!matched || totalSeconds <= 0) {
    return null;
  }
  return totalSeconds;
};

export const parseDurationToMinutes = (input: string): number | null => {
  const seconds = parseDurationToSeconds(input);
  if (seconds === null) {
    return null;
  }
  const minutes = seconds / 60;
  return minutes > 0 ? minutes : null;
};

export const extractTimer = (message: string): TimerExtraction => {
  const durationSeconds = parseDurationToSeconds(message) ?? undefined;
  const cleaned = message
    .replace(/\b(timer|cooldown|respawn|cd)\b/gi, "")
    .replace(durationRegex(), "")
    .replace(/\bin\b/gi, "")
    .replace(/[:]+/g, "")
    .trim();
  const name = cleaned ? cleaned : undefined;
  return { name, durationSeconds };
};

export const extractTracker = (message: string): TrackerExtraction => {
  const startValue = parseNumber(message.match(/\bstart\s*([0-9]+(?:\.[0-9]+)?)\b/i)?.[1]);
  const endValue = parseNumber(message.match(/\bend\s*([0-9]+(?:\.[0-9]+)?)\b/i)?.[1]);
  const durationMinutes = parseDurationToMinutes(message) ?? undefined;
  const metricMatch = message.match(/\bmetric\s+([A-Za-z0-9_]+)\b/i)?.[1];
  const metricName = metricMatch
    ? metricMatch
    : /xp|exp/i.test(message)
      ? "XP"
      : "XP";
  return { metricName, startValue, endValue, durationMinutes };
};

export const extractRoi = (message: string): RoiExtraction => {
  const cost = parseNumber(
    message.match(/\b(?:cost|costo)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\b/i)?.[1]
  );
  const revenue = parseNumber(
    message.match(/\b(?:revenue|venta|sell)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\b/i)?.[1]
  );
  const feePercent = parseNumber(
    message.match(/\bfees?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*%/i)?.[1]
  );
  const feeFixed = parseNumber(
    message.match(/\bfixed\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\b/i)?.[1] ??
      message.match(/\bfees?\s*[:=]?\s*[$€£]?\s*([0-9]+(?:\.[0-9]+)?)\b(?!\s*%)/i)?.[1]
  );
  return { cost, revenue, feePercent, feeFixed };
};

export const extractTable = (message: string): TableExtraction => {
  const columnsMatch = message.match(/\b(?:columns|cols)\s*[:=]?\s*([A-Za-z0-9_,\s-]+)\b/i)?.[1];
  if (columnsMatch) {
    const columns = columnsMatch
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (columns.length > 0) {
      return { columns: columns.join(", ") };
    }
  }
  if (/\bmarket\b/i.test(message)) {
    return { columns: "item, buy, sell" };
  }
  return {};
};

export const extractNotes = (message: string): NotesExtraction => {
  const textMatch = message.match(/\btext:\s*(.+)$/i)?.[1];
  const text = textMatch ? textMatch.trim() : message.trim();
  return { text: text || undefined };
};
