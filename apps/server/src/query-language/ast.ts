export type ComparisonOp = ">" | "<" | ">=" | "<=" | "=";

export type FieldTerm =
  | { type: "mode"; value: string }
  | { type: "mapper"; value: string }
  | { type: "title"; value: string; prefix?: boolean }
  | { type: "artist"; value: string; prefix?: boolean }
  | { type: "difficulty"; value: string; prefix?: boolean }
  | { type: "stars"; min?: number; max?: number; op?: ComparisonOp; value?: number }
  | { type: "key"; min?: number; max?: number; op?: ComparisonOp; value?: number }
  | { type: "ln"; min?: number; max?: number; op?: ComparisonOp; value?: number }
  | { type: "mods"; value: string }
  | { type: "acc"; min?: number; max?: number; op?: ComparisonOp; value?: number }
  | { type: "misses"; min?: number; max?: number; op?: ComparisonOp; value?: number }
  | { type: "score"; min?: number; max?: number; op?: ComparisonOp; value?: number }
  | { type: "retry"; op: ComparisonOp; value: number }
  | { type: "mastery"; op: ComparisonOp; value: number }
  | { type: "played"; days: number }
  | { type: "played"; never: true }
  | { type: "pp"; op: ComparisonOp; value: number }
  | { type: "text"; value: string }
  /** Sunny dan label substring (est_diff), e.g. Reform / Alpha / Regular. */
  | { type: "dan"; value: string; prefix?: boolean }
  /** Daniel dan label substring (4K RC), e.g. Alpha / Beta. */
  | { type: "daniel"; value: string; prefix?: boolean }
  /** Sunny rework star rating (numeric). */
  | {
      type: "sunny";
      min?: number;
      max?: number;
      op?: ComparisonOp;
      value?: number;
    }
  /** 7k dominant pattern label (jack, jumpstream, chordjack, bracket, chordstream, stream). */
  | { type: "pattern"; value: string; prefix?: boolean }
  /** RC vs LN map axis from Sunny ln_ratio (20% split, same as dan). */
  | { type: "axis"; value: "rc" | "ln" | "fln" }
  /** Best nomod/mirror score grade bucket (D/C/B/A/S/SS/X). */
  | { type: "grade"; value: "D" | "C" | "B" | "A" | "S" | "SS" | "X" }
  /** Beatmap set online status (ranked, loved, pending, …). */
  | { type: "status"; values: string[] };

export type AstNode =
  | { type: "term"; term: FieldTerm }
  | { type: "and"; left: AstNode; right: AstNode }
  | { type: "or"; left: AstNode; right: AstNode }
  | { type: "not"; node: AstNode };

export class QueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryParseError";
  }
}
