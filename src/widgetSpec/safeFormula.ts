export type Token =
  | { type: "number"; value: string }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" }
  | { type: "lparen"; value: "(" }
  | { type: "rparen"; value: ")" };

const isDigit = (char: string) => char >= "0" && char <= "9";
const isIdentifierStart = (char: string) =>
  (char >= "A" && char <= "Z") ||
  (char >= "a" && char <= "z") ||
  char === "_";
const isIdentifierPart = (char: string) =>
  isIdentifierStart(char) || isDigit(char);

const tokenizeInternal = (
  formula: string
): { ok: true; tokens: Token[] } | { ok: false; error: string } => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < formula.length) {
    const char = formula[index];

    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }

    if (isDigit(char)) {
      const start = index;
      while (index < formula.length && isDigit(formula[index])) {
        index += 1;
      }
      if (formula[index] === ".") {
        if (!isDigit(formula[index + 1] ?? "")) {
          return { ok: false, error: "invalid number literal" };
        }
        index += 1;
        while (index < formula.length && isDigit(formula[index])) {
          index += 1;
        }
      }
      tokens.push({ type: "number", value: formula.slice(start, index) });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < formula.length && isIdentifierPart(formula[index])) {
        index += 1;
      }
      tokens.push({ type: "identifier", value: formula.slice(start, index) });
      continue;
    }

    if (char === "+" || char === "-" || char === "*" || char === "/") {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "lparen", value: char });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rparen", value: char });
      index += 1;
      continue;
    }

    return { ok: false, error: `disallowed character '${char}'` };
  }

  return { ok: true, tokens };
};

export const tokenizeFormula = (formula: string): Token[] => {
  const result = tokenizeInternal(formula);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.tokens;
};

export const validateFormula = (
  formula: string,
  allowedIdentifiers: Set<string>
): { ok: true } | { ok: false; error: string } => {
  if (!formula.trim()) {
    return { ok: false, error: "formula is empty" };
  }

  const tokenResult = tokenizeInternal(formula);
  if (!tokenResult.ok) {
    return { ok: false, error: tokenResult.error };
  }

  const tokens = tokenResult.tokens;
  if (tokens.length === 0) {
    return { ok: false, error: "formula is empty" };
  }

  let expectingOperand = true;
  let depth = 0;
  let previous: Token | null = null;

  for (const token of tokens) {
    if (expectingOperand) {
      if (token.type === "number") {
        expectingOperand = false;
      } else if (token.type === "identifier") {
        if (!allowedIdentifiers.has(token.value)) {
          return { ok: false, error: `unknown identifier '${token.value}'` };
        }
        expectingOperand = false;
      } else if (token.type === "lparen") {
        depth += 1;
      } else if (token.type === "operator") {
        if (previous?.type === "operator" && previous.value === token.value) {
          return {
            ok: false,
            error: `double operator '${token.value}${token.value}'`
          };
        }
        if (token.value !== "+" && token.value !== "-") {
          return { ok: false, error: `operator '${token.value}' cannot appear here` };
        }
      } else {
        if (previous?.type === "lparen") {
          return { ok: false, error: "empty parentheses" };
        }
        return { ok: false, error: "missing operand before ')'" };
      }
    } else {
      if (token.type === "operator") {
        expectingOperand = true;
      } else if (token.type === "rparen") {
        if (previous?.type === "lparen") {
          return { ok: false, error: "empty parentheses" };
        }
        depth -= 1;
        if (depth < 0) {
          return { ok: false, error: "unbalanced ')'" };
        }
      } else if (token.type === "lparen") {
        if (previous?.type === "identifier") {
          return { ok: false, error: "function calls not allowed" };
        }
        return { ok: false, error: "missing operator before '('" };
      } else if (token.type === "identifier") {
        return { ok: false, error: "missing operator before identifier" };
      } else {
        return { ok: false, error: "missing operator before number" };
      }
    }

    previous = token;
  }

  if (depth !== 0) {
    return { ok: false, error: "unbalanced parentheses" };
  }

  if (expectingOperand) {
    return { ok: false, error: "expression cannot end with an operator" };
  }

  return { ok: true };
};
