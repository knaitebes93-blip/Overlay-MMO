import { overlayPlanSchema } from "./planSchema";
import { validateWidgetSpec, WidgetSpecValidationResult } from "../widgetSpec";

export type PlanValidationResult = {
  overlay: ReturnType<typeof overlayPlanSchema.safeParse>;
  widgetSpec: WidgetSpecValidationResult;
};

export const runPlanValidations = (input: unknown): PlanValidationResult => ({
  overlay: overlayPlanSchema.safeParse(input),
  widgetSpec: validateWidgetSpec(input)
});
