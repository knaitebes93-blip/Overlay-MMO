import { parseDurationToSeconds } from "./extractors";
import { FieldDef } from "./widgetTemplates";
import { WidgetSpecWidget } from "../widgetSpec/widgetSpec";

export type Question = {
  id: string;
  widgetId: string;
  key: string;
  question: string;
  expectedType: FieldDef["type"];
  choices?: string[];
  required: boolean;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  return undefined;
};

const normalizeNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "0"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
};

const normalizeDuration = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseDurationToSeconds(value);
    return parsed ?? undefined;
  }
  return undefined;
};

export const coerceAnswerValue = (field: FieldDef, value: unknown): unknown => {
  switch (field.type) {
    case "number":
      return normalizeNumber(value);
    case "boolean":
      return normalizeBoolean(value);
    case "duration":
      return normalizeDuration(value);
    case "enum": {
      const normalized = normalizeString(value);
      if (!normalized || !field.choices) {
        return undefined;
      }
      return field.choices.includes(normalized) ? normalized : undefined;
    }
    case "string":
    default:
      return normalizeString(value);
  }
};

const isValueValid = (field: FieldDef, value: unknown): boolean => {
  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "duration":
      return typeof value === "number" && Number.isFinite(value) && value > 0;
    case "enum":
      return typeof value === "string" && !!field.choices?.includes(value);
    case "string":
    default:
      return typeof value === "string" && value.trim().length > 0;
  }
};

export const applyAnswersToWidget = (
  widget: WidgetSpecWidget,
  answers: Record<string, unknown>
): WidgetSpecWidget => {
  const requiredFields = widget.data?.requiredFields as FieldDef[] | undefined;
  if (!requiredFields || requiredFields.length === 0) {
    return widget;
  }
  const values = (widget.data?.values ?? {}) as Record<string, unknown>;
  requiredFields.forEach((field) => {
    const answerKey = `${widget.id}.${field.key}`;
    if (!(answerKey in answers)) {
      return;
    }
    const coerced = coerceAnswerValue(field, answers[answerKey]);
    if (coerced !== undefined) {
      values[field.key] = coerced;
    }
  });
  return {
    ...widget,
    data: {
      ...widget.data,
      values
    }
  };
};

export const buildQuestionsForWidget = (widget: WidgetSpecWidget): Question[] => {
  const requiredFields = widget.data?.requiredFields as FieldDef[] | undefined;
  if (!requiredFields || requiredFields.length === 0) {
    return [];
  }
  const values = (widget.data?.values ?? {}) as Record<string, unknown>;

  return requiredFields
    .filter((field) => field.required !== false)
    .filter((field) => !isValueValid(field, values[field.key]))
    .map((field) => ({
      id: `${widget.id}.${field.key}`,
      widgetId: widget.id,
      key: field.key,
      question: field.question ?? `${field.label}?`,
      expectedType: field.type,
      choices: field.choices,
      required: field.required !== false
    }));
};
