import { validateFormula } from "../src/widgetSpec/safeFormula";

type Case = {
  formula: string;
  allowed: Set<string>;
  valid: boolean;
};

const cases: Case[] = [
  {
    formula: "(end_value - start_value) / duration_minutes * 60",
    allowed: new Set(["end_value", "start_value", "duration_minutes"]),
    valid: true
  },
  {
    formula: "revenue * fee_percent / 100",
    allowed: new Set(["revenue", "fee_percent"]),
    valid: true
  },
  {
    formula: "revenue - cost - fee_total",
    allowed: new Set(["revenue", "cost", "fee_total"]),
    valid: true
  },
  {
    formula: "-(end_value - start_value)",
    allowed: new Set(["end_value", "start_value"]),
    valid: true
  },
  {
    formula: "Math.max(a,b)",
    allowed: new Set(["a", "b"]),
    valid: false
  },
  {
    formula: "sum(x)",
    allowed: new Set(["x"]),
    valid: false
  },
  {
    formula: "a**2",
    allowed: new Set(["a"]),
    valid: false
  },
  {
    formula: "a; b",
    allowed: new Set(["a", "b"]),
    valid: false
  },
  {
    formula: "a/(b- )",
    allowed: new Set(["a", "b"]),
    valid: false
  },
  {
    formula: "unknown_key + 1",
    allowed: new Set(["a"]),
    valid: false
  },
  {
    formula: "a(b)",
    allowed: new Set(["a", "b"]),
    valid: false
  },
  {
    formula: "a[0]",
    allowed: new Set(["a"]),
    valid: false
  },
  {
    formula: "a.b",
    allowed: new Set(["a", "b"]),
    valid: false
  }
];

const failures: string[] = [];

cases.forEach((testCase, index) => {
  const result = validateFormula(testCase.formula, testCase.allowed);
  const isValid = result.ok;
  if (isValid !== testCase.valid) {
    failures.push(
      `Case ${index + 1} (${testCase.formula}): expected ${testCase.valid ? "valid" : "invalid"}, got ${isValid ? "valid" : "invalid"}${result.ok ? "" : ` (${result.error})`}`
    );
  }
});

if (failures.length > 0) {
  failures.forEach((failure) => console.error(failure));
  process.exitCode = 1;
} else {
  console.log("All safe formula checks passed.");
}
