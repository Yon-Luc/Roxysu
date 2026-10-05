// @generated from osu.Game.Rulesets.Mania/Difficulty/Utils/RootFinding.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate


/** Generated from C# class RootFinding */
export const RootFinding = {
  FindRootExpand(function_: (x: number) => number, guessLowerBound: number, guessUpperBound: number, maxIterations: number = 25, accuracy: number = 1e-6): number {
    const max_expansions = 32;
    let a = guessLowerBound;
    let b = guessUpperBound;
    let fa = function_(a);
    let fb = function_(b);
    let expansions = 0;
    while (((fa * fb) > 0)) {
      a = b;
      b *= 2;
      fa = function_(a);
      fb = function_(b);
      if (((++expansions) > max_expansions)) {
        throw new Error(["guessUpperBound", "The root could not be bracketed."].join(": "));
      }
    }
    let t = 0.5;
    for (let i = 0; (i < maxIterations); (i++)) {
      let xt = (a + (t * ((b - a))));
      let ft = function_(xt);
      let c;
      let fc;
      if ((Math.sign(ft) == Math.sign(fa))) {
        c = a;
        fc = fa;
      }
      else {
        c = b;
        b = a;
        fc = fb;
        fb = fa;
      }
      a = xt;
      fa = ft;
      let xm;
      let fm;
      if ((Math.abs(fa) < Math.abs(fb))) {
        xm = a;
        fm = fa;
      }
      else {
        xm = b;
        fm = fb;
      }
      if ((fm == 0)) {
        return xm;
      }
      let tol = (((2 * accuracy) * Math.abs(xm)) + (2 * accuracy));
      let tlim = (tol / Math.abs((b - c)));
      if ((tlim > 0.5)) {
        return xm;
      }
      let chi = (((a - b)) / ((c - b)));
      let phi = (((fa - fb)) / ((fc - fb)));
      let inverseQuadratic = (((phi * phi) < chi) && ((((1 - phi)) * ((1 - phi))) < chi));
      if (inverseQuadratic) {
        t = ((((fa / ((fb - fa))) * fc) / ((fb - fc))) + (((((((c - a)) / ((b - a))) * fa) / ((fc - fa))) * fb) / ((fc - fb))));
      }
      else {
        t = 0.5;
      }
      t = Math.min((1 - tlim), Math.max(tlim, t));
    }
    return 0;
  },

};

export default RootFinding;
