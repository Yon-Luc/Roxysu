import { Link } from "@tanstack/react-router";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";

export function PreviewSkinSection() {
  const { dict } = useAppDict();

  return (
    <section
      id={pageSectionDomId("preview-skin")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.previewSkin}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.previewSkinDesc}
      </p>
      <Link to="/skin" className="rx-btn-primary mt-4 inline-flex">
        {dict?.settings.openSkinEditor}
      </Link>
    </section>
  );
}
