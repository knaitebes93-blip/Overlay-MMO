import { z } from "zod";
import { validateFormula } from "./safeFormula";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type RequiredFieldDef = {
  key: string;
  [key: string]: unknown;
};

export type CalculationDef = {
  key: string;
  formula: string;
  [key: string]: unknown;
};

export type WidgetSpecWidget = {
  id: string;
  type: string;
  title?: string;
  data?: {
    requiredFields?: RequiredFieldDef[];
    [key: string]: unknown;
  };
  calculations?: CalculationDef[];
  [key: string]: unknown;
};

export type WidgetSpec = {
  version: "1.0";
  profileId: string;
  widgets: WidgetSpecWidget[];
};

export type Widget = WidgetSpecWidget;

const requiredFieldSchema = z
  .object({
    key: z.string().min(1)
  })
  .passthrough();

const calculationDefSchema = z
  .object({
    key: z.string().min(1),
    formula: z.string().min(1)
  })
  .passthrough();

const widgetSpecWidgetSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string().optional(),
    data: z
      .object({
        requiredFields: z.array(requiredFieldSchema).optional()
      })
      .passthrough()
      .optional(),
    calculations: z.array(calculationDefSchema).optional()
  })
  .passthrough();


const formatWidgetLabel = (index: number, id?: string) =>
  id ? `widget[${index}] (id: ${id})` : `widget[${index}]`;

export const widgetSpecSchema: z.ZodType<WidgetSpec> = z
  .object({
    version: z.literal("1.0"),
    profileId: z.string(),
    widgets: z.array(widgetSpecWidgetSchema)
  })
  .superRefine((spec, ctx) => {
    spec.widgets.forEach((widget: WidgetSpecWidget, widgetIndex: number) => {
      const widgetId = typeof widget.id === "string" ? widget.id : undefined;
      const widgetLabel = formatWidgetLabel(widgetIndex, widgetId);
      const requiredFields = widget.data?.requiredFields ?? [];
      const requiredKeys = new Set<string>();

      requiredFields.forEach((field: RequiredFieldDef, fieldIndex: number) => {
        if (!identifierPattern.test(field.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${widgetLabel} requiredFields[${fieldIndex}] key "${field.key}" is not a valid identifier`,
            path: ["widgets", widgetIndex, "data", "requiredFields", fieldIndex, "key"]
          });
          return;
        }
        requiredKeys.add(field.key);
      });

      const calculations = widget.calculations ?? [];
      const calculationKeys = new Set<string>();

      calculations.forEach((calc: CalculationDef, calcIndex: number) => {
        const calcLabel = `${widgetLabel} calculation "${calc.key}"`;
        let canRegisterKey = true;

        if (!identifierPattern.test(calc.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${calcLabel} key is not a valid identifier`,
            path: ["widgets", widgetIndex, "calculations", calcIndex, "key"]
          });
          canRegisterKey = false;
        }

        if (requiredKeys.has(calc.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${calcLabel} key conflicts with required field "${calc.key}"`,
            path: ["widgets", widgetIndex, "calculations", calcIndex, "key"]
          });
          canRegisterKey = false;
        }

        if (calculationKeys.has(calc.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${calcLabel} key is duplicated`,
            path: ["widgets", widgetIndex, "calculations", calcIndex, "key"]
          });
          canRegisterKey = false;
        }

        const allowedIdentifiers = new Set<string>([
          ...requiredKeys,
          ...calculationKeys
        ]);
        const formulaResult = validateFormula(calc.formula, allowedIdentifiers);
        if (!formulaResult.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${calcLabel}: ${formulaResult.error}`,
            path: ["widgets", widgetIndex, "calculations", calcIndex, "formula"]
          });
        }

        if (canRegisterKey) {
          calculationKeys.add(calc.key);
        }
      });
    });
  });

export type WidgetSpecValidationResult =
  | { ok: true; value: WidgetSpec }
  | { ok: false; error: string };

export const validateWidgetSpec = (
  input: unknown
): WidgetSpecValidationResult => {
  const parsed = widgetSpecSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const detail = parsed.error.errors
    .map((err) => {
      const path = err.path.length ? `${err.path.join(".")}: ` : "";
      return `${path}${err.message}`;
    })
    .join("; ");
  return {
    ok: false,
    error: detail || "Invalid WidgetSpec payload."
  };
};
