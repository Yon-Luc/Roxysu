import { osuWebScoreUrl } from "../lib/osuUrls";
import { useAppDict } from "../lib/i18n";
import { pushToast } from "../lib/toasts";

type ShareScoreLinkButtonProps = {
  onlineId: number | null | undefined;
  className?: string;
};

/** Copy `https://osu.ppy.sh/scores/{onlineId}` when the score was submitted. */
export function ShareScoreLinkButton({
  onlineId,
  className,
}: ShareScoreLinkButtonProps) {
  const { dict } = useAppDict();
  const url = osuWebScoreUrl(onlineId);
  if (!url) return null;

  return (
    <button
      type="button"
      title={url}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const copied =
          dict?.practice.detail.shareScoreCopied ?? "Score link copied";
        void navigator.clipboard.writeText(url).then(
          () => {
            pushToast({ title: copied, detail: url, tone: "success" });
          },
          () => {
            window.open(url, "_blank", "noopener,noreferrer");
          },
        );
      }}
      className={className ?? "rx-btn"}
    >
      {dict?.practice.detail.shareScoreLink ?? "Share link"}
    </button>
  );
}
