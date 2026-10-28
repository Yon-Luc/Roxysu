import type { AstNode, FieldTerm } from "./ast";

/**
 * Score metrics conjoined with mods apply to that score set, not mastery.
 * `mod:IN acc<95` is the best Invert accuracy, not "any Invert score under 95"
 * and not the mastery best (a nomod play must not count).
 *
 * OR distributes the mod scope. NOT blocks it, so `acc>98 NOT mods:NF` stays
 * a mastery check plus "no NF score". `grade` is not a score metric.
 */

const SCORE_METRICS = new Set<FieldTerm["type"]>([
  "acc",
  "misses",
  "score",
  "pp",
]);

export type FoldedNode =
  | { type: "term"; term: FieldTerm }
  | { type: "and"; left: FoldedNode; right: FoldedNode }
  | { type: "or"; left: FoldedNode; right: FoldedNode }
  | { type: "not"; node: FoldedNode }
  /** One score must match this mods expression. */
  | { type: "modsMatch"; mods: AstNode }
  /** Best/fewest of the metric over scores matching `mods`. */
  | { type: "scoreAggregate"; metric: FieldTerm; mods: AstNode };

export function foldScoreConjunctions(ast: AstNode): FoldedNode {
  return lower(ast, null);
}

function isScoreMetric(term: FieldTerm): boolean {
  return SCORE_METRICS.has(term.type);
}

/** Positive mods term, or AND/OR of those. NOT is not a mods expression. */
function isModsExpr(node: AstNode): boolean {
  if (node.type === "term") return node.term.type === "mods";
  if (node.type === "and" || node.type === "or") {
    return isModsExpr(node.left) && isModsExpr(node.right);
  }
  return false;
}

function andMods(left: AstNode | null, right: AstNode): AstNode {
  if (!left) return right;
  return { type: "and", left, right };
}

function flattenAnd(node: AstNode): AstNode[] {
  if (node.type !== "and") return [node];
  return [...flattenAnd(node.left), ...flattenAnd(node.right)];
}

function andAll(nodes: FoldedNode[]): FoldedNode {
  const [first, ...rest] = nodes;
  if (!first) return { type: "term", term: { type: "text", value: "" } };
  return rest.reduce<FoldedNode>(
    (left, right) => ({ type: "and", left, right }),
    first,
  );
}

function lower(node: AstNode, inherited: AstNode | null): FoldedNode {
  if (node.type === "term") {
    if (inherited && isScoreMetric(node.term)) {
      return { type: "scoreAggregate", metric: node.term, mods: inherited };
    }
    if (inherited && node.term.type === "mods") {
      return { type: "modsMatch", mods: andMods(inherited, node) };
    }
    if (inherited) {
      return {
        type: "and",
        left: { type: "modsMatch", mods: inherited },
        right: { type: "term", term: node.term },
      };
    }
    return { type: "term", term: node.term };
  }

  if (node.type === "not") {
    const negated: FoldedNode = { type: "not", node: lower(node.node, null) };
    if (!inherited) return negated;
    return {
      type: "and",
      left: { type: "modsMatch", mods: inherited },
      right: negated,
    };
  }

  if (node.type === "or") {
    return {
      type: "or",
      left: lower(node.left, inherited),
      right: lower(node.right, inherited),
    };
  }

  const factors = flattenAnd(node);
  const modsFactors = factors.filter(isModsExpr);
  const rest = factors.filter((factor) => !isModsExpr(factor));
  const scope = modsFactors.reduce<AstNode | null>(
    (acc, factor) => andMods(acc, factor),
    inherited,
  );
  if (!scope) return andAll(rest.map((factor) => lower(factor, null)));
  if (rest.length === 0) return { type: "modsMatch", mods: scope };
  return andAll(rest.map((factor) => lower(factor, scope)));
}
