import type { ReactNode } from "react";

export function ChartCard({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rx-panel px-4 py-4 sm:px-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  );
}
