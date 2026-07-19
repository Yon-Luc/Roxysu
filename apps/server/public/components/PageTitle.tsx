import type { ReactNode } from "react";
import roxyIcon from "../roxy.png";

export function PageTitle({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 ${className}`.trim()}
    >
      <img
        src={roxyIcon}
        alt=""
        className="size-16 shrink-0 rounded-full object-cover sm:size-20"
      />
      <h1 className="rx-title">{children}</h1>
    </div>
  );
}
