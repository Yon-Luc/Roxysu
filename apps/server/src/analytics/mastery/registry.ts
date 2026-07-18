import type { MasteryFormula } from "./types";
import { simpleFormula } from "./formulas/simple";
import { practiceFormula } from "./formulas/practice";

const formulas = new Map<string, MasteryFormula>();

export function registerFormula(formula: MasteryFormula): void {
  formulas.set(formula.id, formula);
}

export function getFormula(id: string): MasteryFormula | undefined {
  return formulas.get(id);
}

export function listFormulas(): MasteryFormula[] {
  return [...formulas.values()];
}

export const DEFAULT_MASTERY_FORMULA = "simple";

registerFormula(simpleFormula);
registerFormula(practiceFormula);
