import type { AstNode } from "./ast";

/** True when the AST references 7k pattern analysis (`pattern:` / `dominant:` / `style:`). */
export function astUsesPatternAnalysis(node: AstNode): boolean {
  switch (node.type) {
    case "term":
      return node.term.type === "pattern";
    case "and":
    case "or":
      return (
        astUsesPatternAnalysis(node.left) || astUsesPatternAnalysis(node.right)
      );
    case "not":
      return astUsesPatternAnalysis(node.node);
  }
}
