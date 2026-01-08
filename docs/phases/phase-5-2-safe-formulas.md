# Phase 5.2 – Safe Formula Validation

This step introduces deterministic validation for `CalculationDef.formula` to keep formulas safe and constrained. The validator only tokenizes and checks syntax; it never evaluates the formula.

## Allowed tokens
- Numbers: integers or decimals (no scientific notation).
- Identifiers: `[A-Za-z_][A-Za-z0-9_]*`
- Operators: `+`, `-`, `*`, `/`
- Parentheses: `(` and `)`
- Whitespace is ignored.

## Disallowed
- Quotes, commas, semicolons, braces/brackets.
- Dots (`.`) to prevent property access.
- Function calls (identifier directly followed by `(`).
- Double operators like `**`, `//`, `++`, `--`.
- Any unknown identifiers not listed in allowed keys.

## Identifier rules
For each calculation, allowed identifiers are:
- `widget.data.requiredFields[].key`
- prior calculation keys in the same `widget.calculations` array

Each `CalculationDef.key` must be a valid identifier and must not collide with required field keys.

## Example

Valid:
```
(end_value - start_value) / duration_minutes * 60
```

Invalid (function call + property access):
```
Math.max(a,b)
```

## Script
Use `scripts/validate-safe-formula.ts` to run the sample cases against the validator.
