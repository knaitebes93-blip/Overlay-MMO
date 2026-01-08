import { detectIntents, IntentType } from "./intent";
import {
  extractNotes,
  extractRoi,
  extractTable,
  extractTimer,
  extractTracker
} from "./extractors";
import {
  createNotesWidget,
  createRoiPanelWidget,
  createTableWidget,
  createTimerWidget,
  createTrackerWidget
} from "./widgetTemplates";
import { applyAnswersToWidget, buildQuestionsForWidget, Question } from "./questions";
import { validateWidgetSpec, WidgetSpec, WidgetSpecWidget } from "../widgetSpec";

export type BuildArgs = {
  message: string;
  profileId: string;
  currentPlan?: WidgetSpec;
  answers?: Record<string, unknown>;
};

export type BuildResult = {
  draftPlan?: WidgetSpec;
  nextQuestions: Question[];
  debug?: string[];
};

const fnv1aHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const buildWidgetForIntent = (
  intent: IntentType,
  id: string,
  message: string
): WidgetSpecWidget => {
  switch (intent) {
    case "timer": {
      const extraction = extractTimer(message);
      return createTimerWidget(id, {
        name: extraction.name,
        durationSeconds: extraction.durationSeconds
      });
    }
    case "tracker": {
      const extraction = extractTracker(message);
      return createTrackerWidget(id, {
        metricName: extraction.metricName,
        startValue: extraction.startValue,
        endValue: extraction.endValue,
        durationMinutes: extraction.durationMinutes
      });
    }
    case "roi_panel": {
      const extraction = extractRoi(message);
      return createRoiPanelWidget(id, {
        cost: extraction.cost,
        revenue: extraction.revenue,
        feePercent: extraction.feePercent,
        feeFixed: extraction.feeFixed
      });
    }
    case "table": {
      const extraction = extractTable(message);
      return createTableWidget(id, { columns: extraction.columns });
    }
    case "alert":
    case "notes":
    default: {
      const extraction = extractNotes(message);
      return createNotesWidget(id, { text: extraction.text });
    }
  }
};

const mergeWidgets = (
  existing: WidgetSpecWidget[],
  incoming: WidgetSpecWidget[]
): { widgets: WidgetSpecWidget[]; newWidgetIds: Set<string> } => {
  const next = [...existing];
  const newWidgetIds = new Set<string>();

  incoming.forEach((widget) => {
    newWidgetIds.add(widget.id);
    const index = next.findIndex((candidate) => candidate.id === widget.id);
    if (index >= 0) {
      next[index] = widget;
    } else {
      next.push(widget);
    }
  });

  return { widgets: next, newWidgetIds };
};

export const buildPlanFromChat = (args: BuildArgs): BuildResult => {
  const message = args.message.trim();
  const debug: string[] = [];
  if (!message) {
    return { nextQuestions: [], debug: ["Empty message."] };
  }

  if (message.toLowerCase() === "reset") {
    const draftPlan: WidgetSpec = {
      version: "1.0",
      profileId: args.profileId,
      widgets: []
    };
    return { draftPlan, nextQuestions: [], debug: ["Reset plan."] };
  }

  const intents = detectIntents(message);
  debug.push(`Intents: ${intents.join(", ")}`);

  const hash = fnv1aHash(message.toLowerCase());
  const incomingWidgets = intents.map((intent, index) =>
    buildWidgetForIntent(intent, `${intent}_${hash}_${index + 1}`, message)
  );

  const existingWidgets = args.currentPlan?.widgets ?? [];
  const { widgets, newWidgetIds } = mergeWidgets(existingWidgets, incomingWidgets);
  const answers = args.answers ?? {};

  const hydrated = widgets.map((widget) => applyAnswersToWidget(widget, answers));

  const nextQuestions = hydrated
    .filter((widget) => newWidgetIds.has(widget.id))
    .flatMap((widget) => buildQuestionsForWidget(widget));

  if (nextQuestions.length > 0) {
    debug.push(`Missing fields: ${nextQuestions.length}`);
    return { nextQuestions, debug };
  }

  const draftPlan: WidgetSpec = {
    version: "1.0",
    profileId: args.profileId,
    widgets: hydrated
  };
  const validation = validateWidgetSpec(draftPlan);
  if (!validation.ok) {
    debug.push(`WidgetSpec validation failed: ${validation.error}`);
    return { nextQuestions: [], debug };
  }

  debug.push(`Draft plan ready with ${draftPlan.widgets.length} widgets.`);
  return { draftPlan, nextQuestions: [], debug };
};
