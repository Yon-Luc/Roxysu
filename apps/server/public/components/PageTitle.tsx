import type { ReactNode } from "react";

export function PageTitle({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <h1 className={`rx-title ${className}`.trim()}>{children}</h1>;
}
