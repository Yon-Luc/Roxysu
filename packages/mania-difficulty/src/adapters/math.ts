/** Handwritten stand-ins for osu.Framework.Utils.Precision used by generated polynomial code. */
export const Precision = {
  AlmostEquals(a: number, b: number, epsilon = 1e-6): boolean {
    return Math.abs(a - b) <= epsilon;
  },
};
