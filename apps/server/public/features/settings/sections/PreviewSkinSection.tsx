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
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/skin" className="rx-btn-primary inline-flex">
          {dict?.settings.openSkinEditor}
        </Link>
        <Link
          to="/skin"
          search={{ section: "std-skin" }}
          className="rx-btn inline-flex"
        >
          {dict?.settings.openStdSkinEditor}
        </Link>
      </div>
    </section>
  );
}
