import { useState } from "react";
import { pageSectionDomId } from "../../../lib/pageSections";
import { useAppDict } from "../../../lib/i18n";
import { KeybindModal } from "../KeybindModal";

export function KeybindsSection() {
  const { dict } = useAppDict();
  const [open, setOpen] = useState(false);

  return (
    <section
      id={pageSectionDomId("keybinds")}
      className="rx-panel scroll-mt-6 p-5"
    >
      <h2 className="text-sm font-bold text-ink">
        {dict?.settings.keybinds}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {dict?.settings.keybindsDesc}
      </p>
      <button
        type="button"
        className="rx-btn-primary mt-4"
        onClick={() => setOpen(true)}
      >
        {dict?.settings.editKeybinds}
      </button>
      <KeybindModal open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
