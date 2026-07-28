import type { ReactNode } from "react";
import { PageTitle } from "./PageTitle";

export function SkeletonBlock({
  className,
}: {
  className: string;
}) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-lg bg-highlight/80 ${className}`}
    />
  );
}

export function PageHeaderSkeleton({
  subtitleWidth = "max-w-xl",
  actions,
}: {
  subtitleWidth?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <PageTitle>
          <SkeletonBlock className="h-[1em] w-40 max-w-full rounded-xl" />
        </PageTitle>
        <div className="mt-2">
          <SkeletonBlock className={`h-4 ${subtitleWidth}`} />
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatGridSkeleton({
  count = 4,
}: {
  count?: number;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rx-stat">
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="mt-3 h-8 w-24" />
        </div>
      ))}
    </section>
  );
}

export function ChartGridSkeleton({
  count = 2,
}: {
  count?: number;
}) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rx-panel px-4 py-4 sm:px-5">
          <SkeletonBlock className="mb-4 h-4 w-32" />
          <SkeletonBlock className="h-52 w-full" />
        </div>
      ))}
    </section>
  );
}

export function ListSkeleton({
  count = 6,
  showThumbnail = true,
}: {
  count?: number;
  showThumbnail?: boolean;
}) {
  return (
    <ul className="space-y-0.5">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index} className="rx-row justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {showThumbnail ? (
              <SkeletonBlock className="h-12 w-12 shrink-0 rounded-md" />
            ) : null}
            <div className="min-w-0 flex-1">
              <SkeletonBlock className="h-4 w-40 max-w-full" />
              <SkeletonBlock className="mt-2 h-3 w-56 max-w-full" />
            </div>
          </div>
          <SkeletonBlock className="hidden h-4 w-20 sm:block" />
        </li>
      ))}
    </ul>
  );
}

export function CardGridSkeleton({
  count = 6,
}: {
  count?: number;
}) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index} className="rx-card">
          <SkeletonBlock className="aspect-[2.2/1] w-full rounded-none" />
          <div className="p-4">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="mt-2 h-5 w-40 max-w-full" />
            <SkeletonBlock className="mt-2 h-3 w-48 max-w-full" />
            <div className="mt-4 flex flex-wrap gap-2">
              <SkeletonBlock className="h-3 w-14" />
              <SkeletonBlock className="h-3 w-16" />
              <SkeletonBlock className="h-3 w-14" />
              <SkeletonBlock className="h-3 w-20" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PanelSkeleton({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`rx-panel p-5 ${className}`}>
      <SkeletonBlock className="h-4 w-32" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: lines }).map((_, index) => (
          <SkeletonBlock
            key={index}
            className={`h-4 ${index === lines - 1 ? "w-2/3" : "w-full"}`}
          />
        ))}
      </div>
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <div className="relative mt-4 overflow-hidden rounded-xl">
      <SkeletonBlock className="aspect-[21/9] w-full max-h-64 rounded-none sm:max-h-72" />
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
        <SkeletonBlock className="h-4 w-24" />
        <div className="mt-3 flex items-center gap-3">
          <SkeletonBlock className="h-14 w-14 shrink-0 rounded-full sm:h-16 sm:w-16" />
          <SkeletonBlock className="h-10 w-64 max-w-full" />
        </div>
        <SkeletonBlock className="mt-3 h-4 w-72 max-w-full" />
        <div className="mt-4 flex flex-wrap gap-2">
          <SkeletonBlock className="h-10 w-28 rounded-xl" />
          <SkeletonBlock className="h-10 w-24 rounded-xl" />
          <SkeletonBlock className="h-10 w-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
