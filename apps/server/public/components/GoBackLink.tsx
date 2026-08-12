import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

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
      <BackArrowIcon className="rx-back-icon" />
      <span>{children}</span>
    </Link>
  );
}

function BackArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
