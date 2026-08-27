import type { StyleDesc } from "@gpuix/react";
import { mergeStyles } from "./merge-styles";

type VariantValues = Record<string, StyleDesc>;
type VariantGroups = Record<string, VariantValues>;

type VariantSelection<Variants extends VariantGroups> = {
  [K in keyof Variants]?: keyof Variants[K] | (string & {});
};

type CompoundVariant<Variants extends VariantGroups> = {
  style: StyleDesc;
} & Partial<VariantSelection<Variants>>;

export interface VariantsConfig<Variants extends VariantGroups> {
  base?: StyleDesc;
  variants?: Variants;
  defaultVariants?: Partial<VariantSelection<Variants>>;
  compoundVariants?: Array<CompoundVariant<Variants>>;
}

/**
 * A small CVA-style variant resolver for GPUIX styles.
 *
 * Returns a function that turns a set of variant selections into a single
 * {@link StyleDesc}. Pseudo-state styles inside a variant are merged, not
 * replaced, so `hover` survives composition through `mergeStyles`.
 *
 * @example
 *   const buttonVariants = variants({
 *     base: { display: "flex", borderRadius: 8 },
 *     variants: {
 *       variant: {
 *         default: { backgroundColor: "#7dd3fc" },
 *         destructive: { backgroundColor: "#ef4444" },
 *       },
 *       size: { sm: { height: 32 }, md: { height: 40 } },
 *     },
 *     defaultVariants: { variant: "default", size: "md" },
 *   });
 *
 *   <div style={buttonVariants({ variant: "destructive" })} />
 */
export function variants<Variants extends VariantGroups>(
  config: VariantsConfig<Variants>,
) {
  return (props: VariantSelection<Variants> = {}): StyleDesc => {
    const style: StyleDesc = { ...(config.base ?? {}) };

    if (config.variants) {
      for (const key of Object.keys(config.variants) as Array<
        keyof Variants
      >) {
        const selected =
          props[key] ?? config.defaultVariants?.[key];

        if (selected == null) {
          continue;
        }

        const group = config.variants[key] as VariantValues;
        const variantStyle = group[selected as string] as
          | StyleDesc
          | undefined;

        if (variantStyle) {
          mergeStylesInto(style, variantStyle);
        }
      }
    }

    if (config.compoundVariants) {
      for (const compound of config.compoundVariants) {
        const { style: compoundStyle, ...conditions } = compound as Record<
          string,
          unknown
        >;

        const selections = props as Record<string, unknown>;
        const defaults = config.defaultVariants as Record<string, unknown> | undefined;

        const matches = Object.keys(conditions).every(
          (key) => (selections[key] ?? defaults?.[key]) === conditions[key],
        );

        if (matches && compoundStyle) {
          mergeStylesInto(style, compoundStyle as StyleDesc);
        }
      }
    }

    return style;
  };
}

function mergeStylesInto(target: StyleDesc, source: StyleDesc): void {
  Object.assign(target, mergeStyles(target, source));
}

/** Extract the variant prop shape from a `variants()` result's config. */
export type VariantProps<Config extends VariantsConfig<VariantGroups>> =
  VariantSelection<NonNullable<Config["variants"]>>;
