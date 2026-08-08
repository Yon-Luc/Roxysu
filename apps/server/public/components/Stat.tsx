import { Link } from "@tanstack/react-router";

type StatProps = {
  label: string;
  value: string;
  to?: { to: "/sessions/$sessionId"; params: { sessionId: string } };
};

export function Stat({ label, value, to }: StatProps) {
  const body = (
    <>
      <div className="rx-label">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</div>
    </>
  );
  if (to) {
    return (
      <Link
        to={to.to}
        params={to.params}
        className="rx-stat block transition hover:bg-elevated/30"
      >
        {body}
      </Link>
    );
  }
  return <div className="rx-stat">{body}</div>;
}
