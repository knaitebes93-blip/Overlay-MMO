import {
  LlmSettings,
  OverlayPlan,
  PlannerComposeInput,
  PlannerComposeResult,
  RulesStore
} from "../shared/ipc";
import { runPlanValidations } from "../shared/planValidation";
import { rulesStoreSchema } from "../shared/rulesSchema";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio"]);

const providerDefaults: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.1-8b-instruct:free"
  },
  mistral: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2:1b" },
  lmstudio: { baseUrl: "http://localhost:1234/v1", model: "local-model" },
  custom: { baseUrl: "", model: "" }
};

type ResolvedConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  provider: string;
  headers?: Record<string, string>;
  isLocal: boolean;
};

const detectProvider = (baseUrl: string) => {
  const lower = baseUrl.toLowerCase();
  if (lower.includes("groq.com")) return "groq";
  if (lower.includes("openrouter.ai")) return "openrouter";
  if (lower.includes("mistral.ai")) return "mistral";
  if (lower.includes("localhost:11434")) return "ollama";
  if (lower.includes("localhost:1234")) return "lmstudio";
  if (lower.includes("api.openai.com")) return "openai";
  return "custom";
};

const resolveConfig = (settings?: LlmSettings | null): ResolvedConfig => {
  const envBase = process.env.OPENAI_BASE_URL;
  const envModel = process.env.OPENAI_MODEL;
  const envKey = process.env.OPENAI_API_KEY;

  const active = settings?.enabled ? settings : null;
  const provider = active?.provider ?? (envBase ? detectProvider(envBase) : "openai");
  const defaults =
    providerDefaults[provider] ?? { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL };

  const baseUrl = (active?.baseUrl || envBase || defaults.baseUrl || "").trim();
  const model = (active?.model || envModel || defaults.model || "").trim();
  const apiKey = (active?.apiKey || envKey || "").trim();
  const localByUrl = /localhost|127\.0\.0\.1|\[::1\]|::1/.test(baseUrl);
  const isLocal = LOCAL_PROVIDERS.has(provider) || localByUrl;

  if (!baseUrl || !model) {
    throw new Error("LLM configuration missing. Set provider, base URL, and model.");
  }

  if (!isLocal && !apiKey) {
    throw new Error("LLM API key missing. Set it in AI Provider settings.");
  }

  const headers: Record<string, string> = {};
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "Overlay-MMO";
  }

  return { baseUrl, model, apiKey: apiKey || undefined, provider, headers, isLocal };
};

const fetchWithTimeout = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "GET", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const ensureLocalProviderUp = async (config: ResolvedConfig) => {
  if (!config.isLocal) {
    return;
  }
  const baseRoot = config.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const candidates =
    config.provider === "ollama"
      ? [`${baseRoot}/api/tags`, `${config.baseUrl.replace(/\/+$/, "")}/models`]
      : [`${config.baseUrl.replace(/\/+$/, "")}/models`];

  for (const url of candidates) {
    try {
      await fetchWithTimeout(url, 1200);
      return;
    } catch {
      // Try next endpoint.
    }
  }

  if (config.provider === "ollama") {
    throw new Error(
      "No se detecto Ollama. Instalalo y ejecuta `ollama run llama3.2:1b`, o verifica la URL."
    );
  }
  if (config.provider === "lmstudio") {
    throw new Error(
      "LM Studio no esta activo. Abri LM Studio y habilita el server OpenAI-compatible."
    );
  }
  throw new Error("No se detecto un servidor LLM local. Verifica la URL.");
};

const extractJson = (content: string): string => {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM response does not contain JSON.");
  }
  return content.slice(start, end + 1);
};

const coercePlanShape = (plan: unknown): OverlayPlan | null => {
  if (!plan || typeof plan !== "object") {
    return null;
  }
  const candidate = plan as Record<string, unknown>;
  if (Array.isArray(candidate.widgets)) {
    return {
      version: "1.0",
      widgets: candidate.widgets as OverlayPlan["widgets"]
    };
  }
  return null;
};

const coerceRulesShape = (rules: unknown): RulesStore | null => {
  if (Array.isArray(rules)) {
    return { version: "1.0", rules: rules as RulesStore["rules"] };
  }
  if (rules && typeof rules === "object") {
    const candidate = rules as Record<string, unknown>;
    if (Array.isArray(candidate.rules)) {
      return {
        version: "1.0",
        rules: candidate.rules as RulesStore["rules"]
      };
    }
  }
  return null;
};

const buildSystemPrompt = () =>
  [
    "You are the Overlay MMO composer. Return a JSON object with keys:",
    "- plan: OverlayPlan",
    "- rules: RulesStore",
    "- note: string",
    "",
    "Only return JSON. Do not include Markdown or extra text.",
    "Every JSON must include: plan.version = \"1.0\" and rules.version = \"1.0\".",
    "",
    "OverlayPlan schema:",
    "{",
    '  "version": "1.0",',
    '  "widgets": [',
    '    { "id": "text-1", "type": "text", "title": "Title", "text": "value" },',
    '    { "id": "counter-1", "type": "counter", "title": "Title", "value": 0, "step": 1 },',
    '    { "id": "timer-1", "type": "timer", "title": "Title", "seconds": 0, "running": false },',
    '    { "id": "checklist-1", "type": "checklist", "title": "Title", "items": [ { "id": "item-1", "text": "Task", "checked": false } ] },',
    '    { "id": "eventlog-1", "type": "eventLog", "title": "Title", "eventType": "ocr", "showLast": 5 },',
    '    { "id": "rate-1", "type": "rate", "title": "Title", "eventType": "ocr", "lookbackMinutes": 60 },',
    '    { "id": "projection-1", "type": "projection", "title": "Title", "eventType": "ocr", "lookbackMinutes": 60, "horizonMinutes": 120 },',
    '    { "id": "panel-1", "type": "panel", "title": "Title", "children": [ ...widgets ] }',
    "  ]",
    "}",
    "",
    "RulesStore schema:",
    "{",
    '  "version": "1.0",',
    '  "rules": [',
    "    {",
    '      "id": "rule-1",',
    '      "enabled": true,',
    '      "mode": "includes" | "regex",',
    '      "pattern": "text or regex",',
    '      "action": {',
    '        "type": "setTextWidget",',
    '        "widgetId": "text-1",',
    '        "template": "EXP ${match0}"',
    "      }",
    "    },",
    "    {",
    '      "id": "rule-2",',
    '      "enabled": true,',
    '      "mode": "regex",',
    '      "pattern": "(\\\\d+(?:[.,]\\\\d+)?)%",',
    '      "action": {',
    '        "type": "trackRate",',
    '        "widgetId": "text-2",',
    '        "template": "EXP/h ${rate}${unit}/h",',
    '        "valueSource": "g1",',
    '        "unit": "%",',
    '        "precision": 3,',
    '        "minSeconds": 60',
    "      }",
    "    }",
    "  ]",
    "}",
    "",
    "Template placeholders:",
    "- ${text}: full OCR text",
    "- ${match0}: full regex match",
    "- ${g1}, ${g2}, ...: capture groups",
    "- ${rate}: computed rate per hour",
    "- ${value}: current numeric value",
    "- ${unit}: unit string",
    "",
    "Rules run only on OCR text. Use regex mode when extracting numeric values.",
    "Keep existing widgets unless the user asks to replace everything.",
    "Use stable, readable ids (no timestamps).",
    "If user asks for exp tracker %/h, create two text widgets and a regex rule with trackRate."
  ].join("\n");

const buildUserPrompt = (input: PlannerComposeInput) => `
User request:
${input.message}

Current plan JSON:
${JSON.stringify(input.plan)}

Current rules JSON:
${JSON.stringify(input.rules)}
`;

export const composeWithLlm = async (
  input: PlannerComposeInput,
  settings?: LlmSettings | null
): Promise<PlannerComposeResult> => {
  const config = resolveConfig(settings);
  await ensureLocalProviderUp(config);

  const payload = {
    model: config.model,
    temperature: 0.2,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(input) }
    ]
  };

  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.headers
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`.trim());
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new Error("LLM returned an empty response.");
  }

  const parsed = JSON.parse(extractJson(content)) as unknown;
  const parsedObject =
    parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;

  const hasPlan =
    !!parsedObject && ("plan" in parsedObject || "widgets" in parsedObject);
  const hasRules = !!parsedObject && "rules" in parsedObject;

  const planSource =
    parsedObject && "plan" in parsedObject ? parsedObject.plan : parsedObject;
  const rulesSource =
    parsedObject && "rules" in parsedObject ? parsedObject.rules : parsedObject;

  const coercedPlan = coercePlanShape(planSource);
  const coercedRules = coerceRulesShape(rulesSource);

  const candidatePlan = coercedPlan ?? (hasPlan ? null : input.plan);
  const candidateRules = coercedRules ?? (hasRules ? null : input.rules);

  if (!candidatePlan) {
    throw new Error(
      'LLM returned an invalid plan payload. Expected {"version":"1.0","widgets":[...]}'
    );
  }
  if (!candidateRules) {
    throw new Error(
      'LLM returned invalid rules payload. Expected {"version":"1.0","rules":[...]}'
    );
  }

  const planValidation = runPlanValidations(candidatePlan);
  if (!planValidation.overlay.success) {
    throw new Error(
      `LLM returned an invalid plan: ${planValidation.overlay.error.errors
        .map((err) => err.message)
        .join("; ")}`
    );
  }

  const rulesValidation = rulesStoreSchema.safeParse(candidateRules);
  if (!rulesValidation.success) {
    throw new Error(
      `LLM returned invalid rules: ${rulesValidation.error.errors.map((err) => err.message).join("; ")}`
    );
  }

  return {
    plan: planValidation.overlay.data as OverlayPlan,
    rules: rulesValidation.data as RulesStore,
    note:
      (parsedObject?.note as string | undefined) ?? "LLM composed a new plan."
  };
};
