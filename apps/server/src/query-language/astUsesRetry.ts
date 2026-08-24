import type { AstNode } from "./ast";

/** True when the AST references per-beatmap retry (`retry:`). */
export function astUsesRetry(node: AstNode): boolean {
  switch (node.type) {
    case "term":
      return node.term.type === "retry";
    case "and":
    case "or":
      return astUsesRetry(node.left) || astUsesRetry(node.right);
    case "not":
      return astUsesRetry(node.node);
  }
}
