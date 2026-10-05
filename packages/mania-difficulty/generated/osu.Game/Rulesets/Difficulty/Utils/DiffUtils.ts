// @generated from osu.Game/Rulesets/Difficulty/Utils/DiffUtils.cs
// upstream sha: e6207616bd732c7c00207a060f31cf7729f8390b
// generator: 0.4.0
// Do not edit by hand — regenerate with: bun run port:generate

export const SQRT2 = 1.4142135623730950;

/** Generated from C# class DiffUtils */
export const DiffUtils = {
  SQRT2,

  BPMToMilliseconds(bpm: number, delimiter: number = 4): number {
    return ((60000.0 / delimiter) / bpm);
  },

  MillisecondsToBPM(ms: number, delimiter: number = 4): number {
    return (60000.0 / ((ms * delimiter)));
  },

  _Logistic_a4_0(x: number, midpointOffset: number, multiplier: number, maxValue: number = 1): number {
    return (maxValue / ((1 + Math.exp((multiplier * ((midpointOffset - x)))))));
  },

  _Logistic_a2_1(exponent: number, maxValue: number = 1): number {
    return (maxValue / ((1 + Math.exp(exponent))));
  },

  Logistic(...args: number[]): number {
    if (args.length >= 3 && args.length <= 4) {
      return DiffUtils._Logistic_a4_0(args[0]!, args[1]!, args[2]!, args[3] !== undefined ? args[3]! : 1);
    }
    if (args.length >= 1 && args.length <= 2) {
      return DiffUtils._Logistic_a2_1(args[0]!, args[1] !== undefined ? args[1]! : 1);
    }
    throw new Error("DiffUtils.Logistic: no overload for " + args.length + " args");
  },

  Norm(p: number, ...values: number[]): number {
    let sum = 0;
    for (const x of values) {
      sum += DiffUtils.Pow(x, p);
    }
    return DiffUtils.Pow(sum, (1.0 / p));
  },

  BellCurve(x: number, mean: number, width: number, multiplier: number = 1.0): number {
    return (multiplier * Math.exp((Math.E * (-((DiffUtils.Pow((x - mean), 2) / DiffUtils.Pow(width, 2)))))));
  },

  _SmoothstepBellCurve_a3_0(x: number, mean: number, width: number): number {
    x -= mean;
    x = ((x > 0) ? ((width - x)) : ((width + x)));
    return DiffUtils.Smoothstep(x, 0, width);
  },

  _SmoothstepBellCurve_a1_1(x: number): number {
    x = (0.5 - Math.abs((x - 0.5)));
    x = Math.min(Math.max((x * 2.0), 0.0), 1.0);
    return ((x * x) * ((3.0 - (2.0 * x))));
  },

  SmoothstepBellCurve(...args: number[]): number {
    if (args.length >= 3 && args.length <= 3) {
      return DiffUtils._SmoothstepBellCurve_a3_0(args[0]!, args[1]!, args[2]!);
    }
    if (args.length >= 1 && args.length <= 1) {
      return DiffUtils._SmoothstepBellCurve_a1_1(args[0]!);
    }
    throw new Error("DiffUtils.SmoothstepBellCurve: no overload for " + args.length + " args");
  },

  Smoothstep(x: number, start: number, end: number): number {
    x = Math.min(Math.max((((x - start)) / ((end - start))), 0.0), 1.0);
    return ((x * x) * ((3.0 - (2.0 * x))));
  },

  Smootherstep(x: number, start: number, end: number): number {
    x = Math.min(Math.max((((x - start)) / ((end - start))), 0.0), 1.0);
    return (((x * x) * x) * (((x * (((6.0 * x) - 15.0))) + 10.0)));
  },

  ReverseLerp(x: number, start: number, end: number): number {
    return Math.min(Math.max((((x - start)) / ((end - start))), 0.0), 1.0);
  },

  Erf(x: number): number {
    if ((x == 0)) {
      return 0;
    }
    if (((x) === Number.POSITIVE_INFINITY)) {
      return 1;
    }
    if (((x) === Number.NEGATIVE_INFINITY)) {
      return (-1);
    }
    if (Number.isNaN(x)) {
      return Number.NaN;
    }
    let t = (1.0 / ((1.0 + (0.3275911 * Math.abs(x)))));
    let tau = (t * ((0.254829592 + (t * (((-0.284496736) + (t * ((1.421413741 + (t * (((-1.453152027) + (t * 1.061405429)))))))))))));
    let erf = (1.0 - (tau * Math.exp(((-x) * x))));
    return ((x >= 0) ? erf : (-erf));
  },

  Erfc(x: number): number {
    return (1 - DiffUtils.Erf(x));
  },

  ErfInv(x: number): number {
    if ((x <= (-1))) {
      return Number.NEGATIVE_INFINITY;
    }
    if ((x >= 1)) {
      return Number.POSITIVE_INFINITY;
    }
    if ((x == 0)) {
      return 0;
    }
    const a = 0.147;
    let sgn = Math.sign(x);
    x = Math.abs(x);
    let ln = Math.log((1 - (x * x)));
    let t1 = ((2 / ((Math.PI * a))) + (ln / 2));
    let t2 = (ln / a);
    let baseApprox = (Math.sqrt(((t1 * t1) - t2)) - t1);
    let c = ((x >= 0.85) ? DiffUtils.Pow((((x - 0.85)) / 0.293), 8) : 0);
    let erfInv = (sgn * ((Math.sqrt(baseApprox) + c)));
    return erfInv;
  },

  _Pow_a2_0(x: number, exponent: number): number {
    return Math.pow(x, exponent);
  },

  _Pow_a2_1(x: number, exponent: number): number {
    return (() => { const __v = exponent; switch (__v) { case 0: return 1; case 1: return x; case 2: return (x * x); case 3: return ((x * x) * x); case 4: return (((x * x) * x) * x); case 5: return ((((x * x) * x) * x) * x); default: return Math.pow(x, exponent); } })();
  },

  Pow(...args: number[]): number {
    if (args.length >= 2 && args.length <= 2) {
      return DiffUtils._Pow_a2_0(args[0]!, args[1]!);
    }
    throw new Error("DiffUtils.Pow: no overload for " + args.length + " args");
  },

  ErfcInv(x: number): number {
    return DiffUtils.ErfInv((1 - x));
  },

};

export default DiffUtils;
