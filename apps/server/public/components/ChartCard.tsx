import type { ReactNode } from "react";

export function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rx-panel px-4 py-4 sm:px-5">
      <h3 className="mb-4 text-sm font-bold text-ink">{title}</h3>
      {children}
    </div>
  );
}
