import type { ReactNode } from "react";

export function PageTitle({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  /** Native tooltip, e.g. the full text when `className` clamps the title. */
  title?: string;
}) {
  return (
    <h1 className={`rx-title ${className}`.trim()} title={title}>
      {children}
    </h1>
  );
}
