# Skin System

## Goal

Make appearance replaceable without changing gameplay.

## Skin Responsibilities

- note visuals
- hold visuals
- receptors
- lane backgrounds
- judgments
- hit effects
- UI assets
- hit sounds where supported

## Model

```ts
interface Skin {
  id: string;
  name: string;
  assets: SkinAssets;
  config: SkinConfig;
}
```

## Loader

The loader resolves skin files and validates required assets.

## Fallback

Missing optional assets should fall back to defaults.

Missing critical assets should produce a controlled error/fallback rather than crash gameplay.

## Runtime

The renderer consumes a resolved skin object.

Gameplay must not know about skin assets.

## Deliverable

A default skin plus the ability to swap the visual configuration without modifying gameplay code.
