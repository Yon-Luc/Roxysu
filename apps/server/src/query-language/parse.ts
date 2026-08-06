import { QueryParseError, type AstNode, type ComparisonOp, type FieldTerm } from "./ast";
import { normalizeStatusToken, parseStatusList } from "./status";

type Token =
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "and" }
  | { kind: "or" }
  | { kind: "not" }
  | { kind: "term"; raw: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.trim();

  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i += 1;
    if (i >= s.length) break;

    const ch = s[i]!;
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }

    // Quoted string or bare token until whitespace / paren
    let raw = "";
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < s.length && s[i] !== quote) {
        raw += s[i];
        i += 1;
      }
      if (i >= s.length) throw new QueryParseError("Unclosed quote");
      i += 1; // closing quote
      tokens.push({ kind: "term", raw });
      continue;
    }

    while (i < s.length && !/\s/.test(s[i]!) && s[i] !== "(" && s[i] !== ")") {
      // Allow field:"value with spaces" as a single token.
      if (
        s[i] === ":" &&
        i + 1 < s.length &&
        (s[i + 1] === '"' || s[i + 1] === "'")
      ) {
        raw += ":";
        i += 1;
        const quote = s[i]!;
        raw += quote;
        i += 1;
        while (i < s.length && s[i] !== quote) {
          raw += s[i];
          i += 1;
        }
        if (i >= s.length) throw new QueryParseError("Unclosed quote");
        raw += s[i];
        i += 1;
        continue;
      }
      raw += s[i];
      i += 1;
    }

    const upper = raw.toUpperCase();
    if (upper === "AND") tokens.push({ kind: "and" });
    else if (upper === "OR") tokens.push({ kind: "or" });
    else if (upper === "NOT") tokens.push({ kind: "not" });
    else tokens.push({ kind: "term", raw });
  }

  return tokens;
}

function parseComparison(
  rest: string,
): { op: ComparisonOp; value: number } | null {
  const m = rest.match(/^(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { op: m[1] as ComparisonOp, value: Number(m[2]) };
}

function parseRange(
  rest: string,
): { min?: number; max?: number; op?: ComparisonOp; value?: number } | null {
  const range = rest.match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }
  const cmp = parseComparison(rest);
  if (cmp) return { op: cmp.op, value: cmp.value };
  const plain = rest.match(/^(-?\d+(?:\.\d+)?)$/);
  if (plain) return { min: Number(plain[1]), max: Number(plain[1]) };
  return null;
}

function parsePlayed(rest: string): number | null {
  const m = rest.match(/^last(\d+)d$/i);
  if (!m) return null;
  return Number(m[1]);
}

/** Normalize community pattern synonyms to canonical labels. */
function normalizePatternValue(raw: string): string {
  const compact = raw.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, string> = {
    jack: "jack",
    jacks: "jack",
    jumpstream: "jumpstream",
    js: "jumpstream",
    chordjack: "chordjack",
    cj: "chordjack",
    bracket: "bracket",
    brackets: "bracket",
    chordstream: "chordstream",
    cs: "chordstream",
    delay: "delay",
    delays: "delay",
    stream: "delay",
    streams: "delay",
    mixed: "mixed",
  };
  return aliases[compact] ?? raw.trim().toLowerCase();
}

function normalizeAxisValue(raw: string): "rc" | "ln" | "fln" {
  const compact = raw.trim().toLowerCase();
  if (compact === "rc" || compact === "rice") return "rc";
  if (compact === "ln" || compact === "lnmap") return "ln";
  if (compact === "fln" || compact === "fullln" || compact === "full-ln") {
    return "fln";
  }
  throw new QueryParseError(
    `Invalid axis value: ${raw} (expected rc, rice, ln, lnmap, or fln)`,
  );
}

function parseFieldTerm(raw: string): FieldTerm {
  // Bare text (no colon) — free-text search
  const colon = raw.indexOf(":");
  if (colon === -1) {
    const gluedStatus = raw.match(/^status=(.+)$/i);
    if (gluedStatus) {
      try {
        return { type: "status", values: parseStatusList(gluedStatus[1]!) };
      } catch (err) {
        throw new QueryParseError(
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    // Could be acc>98 style without field prefix... support field+op glued
    const glued = raw.match(/^(acc|retry|mastery|pp|stars|misses|miss|score|keys|key|lns|ln|sunny|danstars|sunnystars)(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)$/i);
    if (glued) {
      const field = glued[1]!.toLowerCase();
      const op = glued[2] as ComparisonOp;
      const value = Number(glued[3]);
      if (field === "acc") return { type: "acc", op, value };
      if (field === "retry") return { type: "retry", op, value };
      if (field === "mastery") return { type: "mastery", op, value };
      if (field === "pp") return { type: "pp", op, value };
      if (field === "stars") return { type: "stars", op, value };
      if (field === "misses" || field === "miss") return { type: "misses", op, value };
      if (field === "score") return { type: "score", op, value };
      if (field === "key" || field === "keys") return { type: "key", op, value };
      if (field === "ln" || field === "lns") return { type: "ln", op, value };
      if (field === "sunny" || field === "danstars" || field === "sunnystars") {
        return { type: "sunny", op, value };
      }
    }
    const bareStatus = normalizeStatusToken(raw);
    if (bareStatus) {
      return { type: "status", values: [bareStatus] };
    }
    return { type: "text", value: raw };
  }

  const field = raw.slice(0, colon).toLowerCase();
  let value = raw.slice(colon + 1);
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  let prefix = false;
  if (value.startsWith("^")) {
    prefix = true;
    value = value.slice(1);
  }

  switch (field) {
    case "mode":
      return { type: "mode", value };
    case "mapper":
      return { type: "mapper", value };
    case "title":
      return { type: "title", value, prefix };
    case "artist":
      return { type: "artist", value, prefix };
    case "difficulty":
    case "diff":
      return { type: "difficulty", value, prefix };
    case "mods":
    case "mod":
      return { type: "mods", value };
    case "stars":
    case "star": {
      const r = parseRange(value);
      if (!r) throw new QueryParseError(`Invalid stars value: ${value}`);
      return { type: "stars", ...r };
    }
    case "key":
    case "keys": {
      const r = parseRange(value);
      if (!r) throw new QueryParseError(`Invalid key value: ${value}`);
      return { type: "key", ...r };
    }
    case "ln":
    case "lns": {
      const r = parseRange(value);
      if (!r) throw new QueryParseError(`Invalid ln value: ${value}`);
      return { type: "ln", ...r };
    }
    case "acc":
    case "accuracy": {
      const r = parseRange(value);
      if (r?.min != null && r?.max != null) {
        return { type: "acc", min: r.min, max: r.max };
      }
      if (value.match(/^\d/)) {
        return { type: "acc", op: ">=", value: Number(value) };
      }
      const cmp = parseComparison(value);
      if (!cmp) throw new QueryParseError(`Invalid acc value: ${value}`);
      return { type: "acc", ...cmp };
    }
    case "miss":
    case "misses": {
      const r = parseRange(value);
      if (r?.min != null && r?.max != null) {
        return { type: "misses", min: r.min, max: r.max };
      }
      if (value.match(/^\d/)) {
        return { type: "misses", op: "=", value: Number(value) };
      }
      const cmp = parseComparison(value);
      if (!cmp) throw new QueryParseError(`Invalid misses value: ${value}`);
      return { type: "misses", ...cmp };
    }
    case "score": {
      const r = parseRange(value);
      if (r?.min != null && r?.max != null) {
        return { type: "score", min: r.min, max: r.max };
      }
      if (value.match(/^\d/)) {
        return { type: "score", op: ">=", value: Number(value) };
      }
      const cmp = parseComparison(value);
      if (!cmp) throw new QueryParseError(`Invalid score value: ${value}`);
      return { type: "score", ...cmp };
    }
    case "retry": {
      if (value.match(/^\d/)) return { type: "retry", op: ">=", value: Number(value) };
      const cmp = parseComparison(value);
      if (!cmp) throw new QueryParseError(`Invalid retry value: ${value}`);
      return { type: "retry", ...cmp };
    }
    case "mastery": {
      if (value.match(/^\d/)) return { type: "mastery", op: ">=", value: Number(value) };
      const cmp = parseComparison(value);
      if (!cmp) throw new QueryParseError(`Invalid mastery value: ${value}`);
      return { type: "mastery", ...cmp };
    }
    case "pp": {
      if (value.match(/^\d/)) return { type: "pp", op: ">=", value: Number(value) };
      const cmp = parseComparison(value);
      if (!cmp) throw new QueryParseError(`Invalid pp value: ${value}`);
      return { type: "pp", ...cmp };
    }
    case "played": {
      if (value.toLowerCase() === "never") {
        return { type: "played", never: true };
      }
      const days = parsePlayed(value);
      if (days == null) throw new QueryParseError(`Invalid played value: ${value} (expected lastNd or never)`);
      return { type: "played", days };
    }
    case "dan": {
      if (!value) throw new QueryParseError("Invalid dan value: empty");
      return { type: "dan", value, prefix };
    }
    case "daniel": {
      if (!value) throw new QueryParseError("Invalid daniel value: empty");
      return { type: "daniel", value, prefix };
    }
    case "sunny":
    case "danstars":
    case "sunnystars": {
      const r = parseRange(value);
      if (!r) throw new QueryParseError(`Invalid sunny value: ${value}`);
      return { type: "sunny", ...r };
    }
    case "pattern":
    case "dominant":
    case "style": {
      if (!value) throw new QueryParseError("Invalid pattern value: empty");
      return { type: "pattern", value: normalizePatternValue(value), prefix };
    }
    case "axis":
    case "rice":
    case "lnmap": {
      if (!value) throw new QueryParseError("Invalid axis value: empty");
      return { type: "axis", value: normalizeAxisValue(value) };
    }
    case "grade":
    case "rank": {
      if (!value) throw new QueryParseError("Invalid grade value: empty");
      const normalized = value.trim().toUpperCase();
      const gradeMap: Record<string, "D" | "C" | "B" | "A" | "S" | "SS" | "X"> =
        {
          D: "D",
          C: "C",
          B: "B",
          A: "A",
          S: "S",
          SH: "S",
          SS: "SS",
          XH: "SS",
          X: "X",
        };
      const grade = gradeMap[normalized];
      if (!grade) {
        throw new QueryParseError(
          `Invalid grade value: ${value} (expected D, C, B, A, S, SS, or X)`,
        );
      }
      return { type: "grade", value: grade };
    }
    case "status": {
      if (!value) throw new QueryParseError("Invalid status value: empty");
      try {
        return { type: "status", values: parseStatusList(value) };
      } catch (err) {
        throw new QueryParseError(
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    default:
      throw new QueryParseError(`Unknown field: ${field}`);
  }
}

/**
 * Recursive descent:
 *   expr := or
 *   or   := and (OR and)*
 *   and  := unary (AND? unary)*   // juxtaposition = AND
 *   unary := NOT unary | primary
 *   primary := ( expr ) | term
 */
export function parseQuery(input: string): AstNode {
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    throw new QueryParseError("Empty query");
  }

  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token {
    const t = tokens[pos];
    if (!t) throw new QueryParseError("Unexpected end of query");
    pos += 1;
    return t;
  }

  function parseExpr(): AstNode {
    return parseOr();
  }

  function parseOr(): AstNode {
    let left = parseAnd();
    while (peek()?.kind === "or") {
      consume();
      const right = parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  function parseAnd(): AstNode {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (!t || t.kind === "or" || t.kind === "rparen") break;
      if (t.kind === "and") {
        consume();
        const right = parseUnary();
        left = { type: "and", left, right };
        continue;
      }
      // juxtaposition = AND
      if (t.kind === "term" || t.kind === "lparen" || t.kind === "not") {
        const right = parseUnary();
        left = { type: "and", left, right };
        continue;
      }
      break;
    }
    return left;
  }

  function parseUnary(): AstNode {
    if (peek()?.kind === "not") {
      consume();
      return { type: "not", node: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): AstNode {
    const t = peek();
    if (!t) throw new QueryParseError("Unexpected end of query");
    if (t.kind === "lparen") {
      consume();
      const node = parseExpr();
      if (peek()?.kind !== "rparen") throw new QueryParseError("Expected )");
      consume();
      return node;
    }
    if (t.kind === "term") {
      consume();
      return { type: "term", term: parseFieldTerm(t.raw) };
    }
    throw new QueryParseError(`Unexpected token: ${t.kind}`);
  }

  const ast = parseExpr();
  if (pos < tokens.length) {
    throw new QueryParseError("Unexpected trailing tokens");
  }
  return ast;
}

/** True when the string looks like a structured query (has field: or boolean ops). */
export function looksLikeQuery(q: string): boolean {
  const trimmed = q.trim();
  if (!trimmed) return false;
  if (/[()]/.test(trimmed)) return true;
  if (/\b(AND|OR|NOT)\b/i.test(trimmed)) return true;
  if (/:\S/.test(trimmed)) return true;
  if (/\b(acc|retry|mastery|pp|stars|misses|miss|score|keys|key|lns|ln|sunny|danstars|sunnystars|pattern|dominant|style|axis|rice|lnmap|grade|rank)(>=|<=|>|<|=)/i.test(trimmed)) return true;
  if (/:(rc|rice|ln|lnmap|fln)\b/i.test(trimmed)) return true;
  if (/\bgrade:[dcbasx]/i.test(trimmed)) return true;
  if (/\bgrade:ss\b/i.test(trimmed)) return true;
  if (/\b(ranked|loved|pending|qualified|approved|graveyard|wip)\b/i.test(trimmed)) {
    return true;
  }
  if (/status=/i.test(trimmed)) return true;
  return false;
}
