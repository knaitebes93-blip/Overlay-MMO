import { WidgetSpecWidget } from "../widgetSpec/widgetSpec";

export type ExpectedType = "string" | "number" | "boolean" | "enum" | "duration";

export type FieldDef = {
  key: string;
  label: string;
  type: ExpectedType;
  required?: boolean;
  question?: string;
  choices?: string[];
};

export type OutputDef = {
  label: string;
  valueKey: string;
  format?: string;
};

export type WidgetTemplate = {
  type: string;
  title: string;
  layout: { w: number; h: number };
  requiredFields: FieldDef[];
  outputs: OutputDef[];
  calculations?: Array<{ key: string; formula: string }>;
};

const buildBaseWidget = (
  id: string,
  template: WidgetTemplate,
  values: Record<string, unknown>
): WidgetSpecWidget => ({
  id,
  type: template.type,
  title: template.title,
  data: {
    requiredFields: template.requiredFields,
    values,
    outputs: template.outputs,
    layout: template.layout
  },
  calculations: template.calculations
});

export const createNotesWidget = (
  id: string,
  values: { text?: string }
): WidgetSpecWidget =>
  buildBaseWidget(
    id,
    {
      type: "notes",
      title: "Notes",
      layout: { w: 320, h: 160 },
      requiredFields: [
        {
          key: "text",
          label: "Text",
          type: "string",
          question: "Notes text?"
        }
      ],
      outputs: [{ label: "Text", valueKey: "text" }]
    },
    { text: values.text }
  );

export const createTimerWidget = (
  id: string,
  values: { name?: string; durationSeconds?: number }
): WidgetSpecWidget =>
  buildBaseWidget(
    id,
    {
      type: "timer",
      title: values.name?.trim() || "Timer",
      layout: { w: 260, h: 120 },
      requiredFields: [
        {
          key: "name",
          label: "Name",
          type: "string",
          question: "Timer name?"
        },
        {
          key: "duration",
          label: "Duration (seconds)",
          type: "duration",
          question: "What is the timer duration? (e.g., 15m, 2h)"
        }
      ],
      outputs: [
        { label: "Name", valueKey: "name" },
        { label: "Duration", valueKey: "duration" }
      ]
    },
    {
      name: values.name,
      duration: values.durationSeconds
    }
  );

export const createTrackerWidget = (
  id: string,
  values: {
    metricName?: string;
    startValue?: number;
    endValue?: number;
    durationMinutes?: number;
  }
): WidgetSpecWidget =>
  buildBaseWidget(
    id,
    {
      type: "tracker",
      title: values.metricName ? `${values.metricName} Rate` : "Rate Tracker",
      layout: { w: 280, h: 140 },
      requiredFields: [
        {
          key: "metric_name",
          label: "Metric",
          type: "string",
          question: "Metric name?"
        },
        {
          key: "start_value",
          label: "Start",
          type: "number",
          question: "Start value?"
        },
        {
          key: "end_value",
          label: "End",
          type: "number",
          question: "End value?"
        },
        {
          key: "duration_minutes",
          label: "Duration (minutes)",
          type: "number",
          question: "Duration in minutes?"
        }
      ],
      outputs: [{ label: "Rate/h", valueKey: "rate_per_hour", format: "0.00" }],
      calculations: [
        {
          key: "rate_per_hour",
          formula: "((end_value - start_value) / duration_minutes) * 60"
        }
      ]
    },
    {
      metric_name: values.metricName,
      start_value: values.startValue,
      end_value: values.endValue,
      duration_minutes: values.durationMinutes
    }
  );

export const createRoiPanelWidget = (
  id: string,
  values: { cost?: number; revenue?: number; feePercent?: number; feeFixed?: number }
): WidgetSpecWidget =>
  buildBaseWidget(
    id,
    {
      type: "roi_panel",
      title: "ROI Panel",
      layout: { w: 320, h: 160 },
      requiredFields: [
        {
          key: "cost",
          label: "Cost",
          type: "number",
          question: "Cost?"
        },
        {
          key: "revenue",
          label: "Revenue",
          type: "number",
          question: "Revenue?"
        },
        {
          key: "fee_percent",
          label: "Fee %",
          type: "number",
          question: "Fee percent?"
        },
        {
          key: "fee_fixed",
          label: "Fixed Fee",
          type: "number",
          required: false,
          question: "Fixed fee? (optional)"
        }
      ],
      outputs: [
        { label: "Net", valueKey: "net", format: "currency" },
        { label: "Margin %", valueKey: "margin_percent", format: "0.00" }
      ],
      calculations: [
        {
          key: "fee_total",
          formula: "(revenue * fee_percent / 100) + fee_fixed"
        },
        {
          key: "net",
          formula: "revenue - cost - fee_total"
        },
        {
          key: "margin_percent",
          formula: "(net / cost) * 100"
        }
      ]
    },
    {
      cost: values.cost,
      revenue: values.revenue,
      fee_percent: values.feePercent,
      fee_fixed: values.feeFixed ?? 0
    }
  );

export const createTableWidget = (
  id: string,
  values: { columns?: string }
): WidgetSpecWidget =>
  buildBaseWidget(
    id,
    {
      type: "table",
      title: "Table",
      layout: { w: 420, h: 220 },
      requiredFields: [
        {
          key: "columns",
          label: "Columns",
          type: "string",
          question: "Columns? (comma-separated)"
        }
      ],
      outputs: [{ label: "Table", valueKey: "table" }]
    },
    {
      columns: values.columns
    }
  );
