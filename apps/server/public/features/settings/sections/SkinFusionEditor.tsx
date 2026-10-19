import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  NONE_DONOR,
  donorManiaKeys,
  formatReport,
  maniaSlotId,
  planFusion,
  type ComboColourSource,
  type FusionResult,
  type ManiaNamespacing,
  type SkinDonor,
  type SlotId,
} from "@server/shared/skinFusion/plan";
import { toOskBytes } from "@server/shared/skinFusion/zip";
import { fetchRealmSkinArchive, fetchRealmSkins } from "../../../lib/api";
import { useAppDict, t } from "../../../lib/i18n";
import {
  donorFromArchiveBytes,
  donorFromFileList,
  downloadBytes,
  lazerDisplayName,
  safeOskFilename,
} from "../../../lib/skinFusionDonors";
import { pageSectionDomId } from "../../../lib/pageSections";

type SlotRow = {
  slot: SlotId;
  label: string;
  /** Needs images (layout-only skins can't supply it). */
  images: boolean;
  /** Label for the empty ("") choice. */
  defaultLabel: string;
};

export function SkinFusionEditor() {
  const { dict } = useAppDict();
  const f = dict?.skin.fusion;
  const [donors, setDonors] = useState<SkinDonor[]>([]);
  const [baseId, setBaseId] = useState("");
  const [slots, setSlots] = useState<Partial<Record<SlotId, string>>>({});
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [creator, setCreator] = useState("");
  const [namespacing, setNamespacing] = useState<ManiaNamespacing>("auto");
  const [comboColourSource, setComboColourSource] = useState<ComboColourSource>("base");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickedRealm, setPickedRealm] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const counter = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const realmSkins = useQuery({
    queryKey: ["realm-skins"],
    queryFn: fetchRealmSkins,
    staleTime: 10_000,
  });

  const effectiveBase = donors.some((d) => d.id === baseId) ? baseId : (donors[0]?.id ?? "");
  const base = donors.find((d) => d.id === effectiveBase) ?? null;
  const suggestedName = useMemo(() => {
    const labels: string[] = [];
    const push = (label: string) => {
      const trimmed = label.trim();
      if (trimmed && !labels.includes(trimmed)) labels.push(trimmed);
    };
    if (base) push(base.label);
    for (const donor of donors) push(donor.label);
    return labels.join(" + ").slice(0, 80);
  }, [base, donors]);
  const resolvedName = (nameTouched ? name : suggestedName || name).trim();

  async function addDonor(work: (id: string) => Promise<SkinDonor>) {
    setBusy(true);
    setLoadError(null);
    try {
      counter.current += 1;
      const donor = await work(`donor-${counter.current}`);
      setDonors((prev) => [...prev, donor]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function addRealm(id: string) {
    const item = realmSkins.data?.items.find((s) => s.id === id);
    if (!item) return;
    void addDonor(async (donorId) => {
      const bytes = await fetchRealmSkinArchive(item.id);
      return donorFromArchiveBytes({
        id: donorId,
        label: item.name,
        creator: item.creator,
        bytes: new Uint8Array(bytes),
      });
    });
    setPickedRealm("");
  }

  function removeDonor(id: string) {
    setDonors((prev) => prev.filter((d) => d.id !== id));
    setSlots((prev) => {
      const next: Partial<Record<SlotId, string>> = {};
      for (const [slot, donorId] of Object.entries(prev)) {
        if (donorId !== id) next[slot as SlotId] = donorId;
      }
      return next;
    });
  }

  const rows = useMemo<SlotRow[]>(() => {
    if (!base) return [];
    const keys = new Set<number>();
    for (const d of donors) for (const k of donorManiaKeys(d)) keys.add(k);
    const baseKeys = new Set(donorManiaKeys(base));
    const baseLabel = t(f?.useBase, { name: base.label });
    const list: SlotRow[] = [
      { slot: "osu", label: f?.slotOsu ?? "osu!standard", images: true, defaultLabel: baseLabel },
      { slot: "taiko", label: f?.slotTaiko ?? "Taiko", images: true, defaultLabel: baseLabel },
      { slot: "fruits", label: f?.slotFruits ?? "Catch", images: true, defaultLabel: baseLabel },
      { slot: "hudGlobal", label: f?.slotHud ?? "HUD layout", images: false, defaultLabel: baseLabel },
      { slot: "songSelect", label: f?.slotSongSelect ?? "Song select layout", images: false, defaultLabel: baseLabel },
      { slot: "bms", label: f?.slotBms ?? "BMS", images: false, defaultLabel: baseLabel },
      {
        slot: "maniaLayout",
        label: f?.slotManiaLayout ?? "Mania layout",
        images: false,
        defaultLabel: f?.useAuto ?? "First mania skin",
      },
    ];
    for (const k of [...keys].sort((a, b) => a - b)) {
      list.push({
        slot: maniaSlotId(k),
        label: t(f?.slotMania, { keys: k }),
        images: true,
        defaultLabel: baseKeys.has(k) ? baseLabel : t(f?.noneBaseLacks, { keys: k }),
      });
    }
    return list;
  }, [base, donors, f]);

  const plan = useMemo<{ result: FusionResult | null; error: string | null }>(() => {
    if (!base) return { result: null, error: null };
    try {
      return {
        result: planFusion({
          name: resolvedName || "Roxysu fusion",
          creator: creator.trim(),
          donors,
          baseId: base.id,
          slots,
          options: { maniaNamespacing: namespacing, comboColourSource },
        }),
        error: null,
      };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [base, donors, slots, resolvedName, creator, namespacing, comboColourSource]);

  function download() {
    if (!plan.result) return;
    const bytes = toOskBytes(plan.result.files, formatReport(plan.result.report));
    downloadBytes(bytes, safeOskFilename(resolvedName || "Roxysu fusion", creator));
  }

  const skinName = resolvedName || "Roxysu fusion";
  const listedName = creator.trim() ? lazerDisplayName(skinName, creator) : `${skinName} (Unknown)`;

  return (
    <div className="space-y-6" id={pageSectionDomId("skin-fusion")}>
      <section className="rx-panel space-y-3 p-5">
        <h2 className="text-sm font-bold text-ink">{f?.title ?? "Skin fusion"}</h2>
        <p className="text-sm text-muted">{f?.desc}</p>
      </section>

      <section className="rx-panel space-y-3 p-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-faint">
          {f?.sources ?? "Source skins"}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rx-input h-9 min-w-56"
            value={pickedRealm}
            disabled={busy || realmSkins.isLoading}
            onChange={(e) => {
              setPickedRealm(e.target.value);
              if (e.target.value) addRealm(e.target.value);
            }}
            aria-label={f?.addFromGame}
          >
            <option value="">{f?.addFromGamePlaceholder ?? "Choose a skin…"}</option>
            {(realmSkins.data?.items ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.hasAssets === false ? ` (${f?.layoutOnly ?? "layout only"})` : ""}
              </option>
            ))}
          </select>
          <button type="button" className="rx-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            {f?.addFile ?? "Add .osk"}
          </button>
          <button type="button" className="rx-btn" disabled={busy} onClick={() => folderRef.current?.click()}>
            {f?.addFolder ?? "Add folder"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".osk,.zip"
            className="hidden"
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = "";
              if (files.length > 0) void addDonor((id) => donorFromFileList(id, files));
            }}
          />
          <input
            ref={folderRef}
            type="file"
            className="hidden"
            // @ts-expect-error non-standard but widely supported folder picker attribute
            webkitdirectory=""
            onChange={(e) => {
              const files = [...(e.currentTarget.files ?? [])];
              e.currentTarget.value = "";
              if (files.length > 0) void addDonor((id) => donorFromFileList(id, files));
            }}
          />
          {busy ? <span className="text-xs text-muted">{f?.loading ?? "Reading skin…"}</span> : null}
        </div>
        {loadError ? <p className="text-sm text-rose-300">{loadError}</p> : null}
        {donors.length === 0 ? (
          <p className="text-sm text-muted">{f?.noSources ?? "Add at least one skin to start."}</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {donors.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-ink">{d.label}</span>
                  <span className="ml-2 text-xs text-muted">
                    {d.files.size} files
                    {!d.hasAssets ? ` · ${f?.layoutOnly ?? "layout only"}` : ""}
                    {donorManiaKeys(d).length > 0 ? ` · ${donorManiaKeys(d).join(", ")}K` : ""}
                  </span>
                </div>
                <button type="button" className="rx-btn text-xs" onClick={() => removeDonor(d.id)}>
                  {f?.remove ?? "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {base ? (
        <>
          <section className="rx-panel space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                <span>{f?.outputName ?? "Skin name"}</span>
                <input
                  className="rx-input h-9"
                  value={resolvedName}
                  maxLength={80}
                  onChange={(e) => {
                    setNameTouched(true);
                    setName(e.target.value);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                <span>{f?.outputCreator ?? "Creator"}</span>
                <input className="rx-input h-9" value={creator} maxLength={80} onChange={(e) => setCreator(e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rx-btn text-xs"
                disabled={!suggestedName}
                onClick={() => {
                  setNameTouched(true);
                  setName(suggestedName);
                }}
              >
                {f?.useSourceNames ?? "Use source names"}
              </button>
              <p className="text-xs text-faint">
                {t(f?.nameHint, { name: listedName })}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                <span>{f?.base ?? "Base skin"}</span>
                <select className="rx-input h-9" value={base.id} onChange={(e) => setBaseId(e.target.value)}>
                  {donors.map((d) => (
                    <option key={d.id} value={d.id} disabled={!d.hasAssets}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                <span>{f?.comboColours ?? "Combo colours"}</span>
                <select
                  className="rx-input h-9"
                  value={comboColourSource}
                  onChange={(e) => setComboColourSource(e.target.value as ComboColourSource)}
                >
                  <option value="base">{f?.comboBase ?? "Base skin"}</option>
                  <option value="osu">{f?.comboOsu ?? "osu!standard skin"}</option>
                  <option value="fruits">{f?.comboFruits ?? "Catch skin"}</option>
                </select>
              </label>
            </div>
            <p className="text-xs text-faint">{f?.baseHint}</p>
            <p className="text-xs text-faint">{f?.comboHint}</p>
          </section>

          <section className="rx-panel space-y-3 p-5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-faint">
              {f?.slots ?? "Which skin for what"}
            </h3>
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {rows.map((row) => {
                const value = slots[row.slot] ?? "";
                return (
                  <label key={row.slot} className="flex flex-col gap-1.5 text-xs text-muted">
                    <span>{row.label}</span>
                    <select
                      className="rx-input h-9"
                      value={value}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSlots((prev) => {
                          const copy = { ...prev };
                          if (next === "") delete copy[row.slot];
                          else copy[row.slot] = next;
                          return copy;
                        });
                      }}
                    >
                      <option value="">{row.defaultLabel}</option>
                      {donors.map((d) => (
                        <option
                          key={d.id}
                          value={d.id}
                          disabled={row.images && !d.hasAssets}
                          title={row.images && !d.hasAssets ? f?.layoutOnlyDisabled : undefined}
                        >
                          {d.label}
                        </option>
                      ))}
                      <option value={NONE_DONOR}>{f?.none ?? "None (game default)"}</option>
                    </select>
                  </label>
                );
              })}
            </div>
            <label className="flex max-w-xs flex-col gap-1.5 pt-2 text-xs text-muted">
              <span>{f?.namespacing ?? "Mania image folders"}</span>
              <select
                className="rx-input h-9"
                value={namespacing}
                onChange={(e) => setNamespacing(e.target.value as ManiaNamespacing)}
              >
                <option value="auto">{f?.nsAuto ?? "Automatic"}</option>
                <option value="always">{f?.nsAlways ?? "Always separate"}</option>
                <option value="never">{f?.nsNever ?? "Keep original paths"}</option>
              </select>
            </label>
            <p className="text-xs text-faint">{f?.nsHint}</p>
          </section>

          <section className="rx-panel space-y-3 p-5">
            {plan.error ? (
              <p className="text-sm text-rose-300">{t(f?.error, { message: plan.error })}</p>
            ) : plan.result ? (
              <>
                <p className="text-sm text-ink">
                  {t(f?.summary, {
                    files: plan.result.report.fileCount,
                    size: (plan.result.report.totalBytes / 1048576).toFixed(1),
                  })}
                </p>
                {plan.result.report.relocated.length > 0 ? (
                  <p className="text-xs text-muted">
                    {t(f?.moved, { count: plan.result.report.relocated.length })}
                  </p>
                ) : null}
                {plan.result.report.droppedCount > 0 ? (
                  <p className="text-xs text-muted">
                    {t(f?.leftOut, { count: plan.result.report.droppedCount })}
                  </p>
                ) : null}
                {plan.result.report.warnings.length > 0 ? (
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-amber-300">
                      {f?.warnings ?? "Warnings"}
                    </h4>
                    <ul className="list-disc space-y-1 pl-5 text-xs text-amber-200/90">
                      {plan.result.report.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="rx-btn-primary" onClick={download}>
                    {f?.download ?? "Download .osk"}
                  </button>
                  <button type="button" className="rx-btn text-xs" onClick={() => setShowDetails((v) => !v)}>
                    {f?.details ?? "Details"}
                  </button>
                </div>
                <p className="text-xs text-faint">{f?.downloadHint}</p>
                {showDetails ? (
                  <pre className="max-h-72 overflow-auto rounded-lg bg-black/30 p-3 text-[11px] leading-relaxed text-muted">
                    {formatReport(plan.result.report)}
                  </pre>
                ) : null}
              </>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
