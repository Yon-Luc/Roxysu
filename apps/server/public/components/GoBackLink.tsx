import type { ReactNode } from "react";
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

type GoBackTo = "/practice" | "/sessions" | "/collections" | "/hub";

export function GoBackLink({
  to,
  children,
  className = "",
  history = false,
}: {
  to: GoBackTo;
  children: ReactNode;
  className?: string;
  /** Return to the previous in-app page when one exists; otherwise follow `to`. */
  history?: boolean;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const classNames = `rx-back ${className}`.trim();
  const icon = <ChevronLeft className="rx-back-icon" />;

  if (history && canGoBack) {
    return (
      <button
        type="button"
        className={`${classNames} cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit]`}
        onClick={() => router.history.back()}
      >
        {icon}
        <span>{children}</span>
      </button>
    );
  }

  return (
    <Link to={to} className={classNames}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}
