import { Link } from "@tanstack/react-router";
import { useAppDict } from "../../lib/i18n";

export function BmsCommunityNav() {
  const { dict } = useAppDict();
  const copy = dict?.bms;
  const link = "text-sm font-medium text-accent";
  return (
    <nav className="flex flex-wrap gap-4">
      <Link to="/bms" className={link}>
        {copy?.title ?? "BMS"}
      </Link>
      <Link to="/bms/feed" search={{}} className={link}>
        {copy?.feed ?? "Feed"}
      </Link>
      <Link to="/bms/statistics" className={link}>
        {copy?.statistics ?? "Statistics"}
      </Link>
      <Link to="/bms/compare" search={{}} className={link}>
        {copy?.compare ?? "Compare"}
      </Link>
    </nav>
  );
}
