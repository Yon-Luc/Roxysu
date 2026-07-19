import type { AstNode } from "./ast";

/** True when the AST references Sunny dan ratings (`dan:` / `sunny:`). */
export function astUsesDanRating(node: AstNode): boolean {
  switch (node.type) {
    case "term":
      return node.term.type === "dan" || node.term.type === "sunny";
    case "and":
    case "or":
      return astUsesDanRating(node.left) || astUsesDanRating(node.right);
    case "not":
      return astUsesDanRating(node.node);
  }
}
