import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

type GoBackTo = "/practice" | "/sessions" | "/collections" | "/hub";

export function GoBackLink({
  to,
  children,
  className = "",
}: {
  to: GoBackTo;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={`rx-back ${className}`.trim()}>
      <ChevronLeft className="rx-back-icon" />
      <span>{children}</span>
    </Link>
  );
}
