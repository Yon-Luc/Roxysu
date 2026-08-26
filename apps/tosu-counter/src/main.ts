import {
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  KEYMODES,
  LANE_COVER_MAX,
  LANE_COVER_MIN,
  getPreviewSkin,
  resolveKeymodeSkin,
  setPreviewSkin,
} from "../../server/public/lib/previewSkin";
import {
  applyImportedManiaSkin,
  draftFromDataTransfer,
  draftFromFileList,
  exportImportedSpriteDataUrls,
  loadImportedManiaSprites,
  resetAllImported,
  type ManiaSkinImportDraft,
  type ManiaSkinSprites,
} from "../../server/public/lib/maniaSkinImport";
import {
  getFolderSkinName,
  getFolderSkinSprites,
  loadFolderSkin,
} from "./folderSkin";
import {
  paintManiaNotefield,
  type PreviewNote,
} from "../../server/public/lib/paintManiaNotefield";
import {
  resizePlayfieldCanvas,
  startPlayfieldRaf,
} from "../../server/public/lib/playfieldRaf";
import { clamp } from "../../server/public/lib/clamp";
import { modsFlagsFromAcronyms, parseManiaNotes } from "./chart";
import {
  connectLiveSocket,
  type LiveFrame,
  type LiveStatus,
} from "./live";
import {
  loadCounterSettings,
  saveCounterSettings,
  type CounterSettings,
} from "./settings";

/** A tosu time sample older than this is stale — freeze the clock. */
const SAMPLE_FRESH_MS = 1500;
/** Debounce chart (re)loads while lazer settles on a difficulty. */
const CHART_DEBOUNCE_MS = 250;

type ChartState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; columnCount: number; notes: PreviewNote[] }
  | { kind: "not-mania" }
  | { kind: "error"; message: string };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  parent: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  parent.appendChild(node);
  return node;
}

function main(): void {
  const settings: CounterSettings = loadCounterSettings();

  document.body.classList.toggle("transparent", settings.transparentBg);

  const stage = el("div", document.body);
  stage.className = "stage";

  const canvas = el("canvas", stage);
  canvas.className = "notefield";

  const status = el("div", document.body);
  status.className = "status";

  const panelToggle = el("button", document.body);
  panelToggle.className = "panel-toggle";
  panelToggle.textContent = "⚙";
  panelToggle.title = "Counter settings";

  const panel = buildPanel(settings);

  panelToggle.addEventListener("click", () => {
    panel.root.classList.toggle("open");
  });

  // --- skin sources (folder pack > browser import > procedural) ------------

  let skinVersion = 0;
  const idbSpriteCache = new Map<number, ManiaSkinSprites | null>();

  function currentSpritesFor(keys: number): ManiaSkinSprites | null {
    return getFolderSkinSprites(keys) ?? idbSpriteCache.get(keys) ?? null;
  }

  function touchSkin(): void {
    skinVersion += 1;
    loop?.invalidate();
    refreshStatus();
  }

  function ensureIdbSprites(keys: number): void {
    if (idbSpriteCache.has(keys)) return;
    idbSpriteCache.set(keys, null);
    void loadImportedManiaSprites(keys).then((sprites) => {
      idbSpriteCache.set(keys, sprites);
      touchSkin();
    });
  }

  function skinLabel(): string {
    const folder = getFolderSkinName();
    if (folder) return `folder: ${folder}`;
    const keys = chart.kind === "ready" ? chart.columnCount : null;
    if (keys != null && KEYMODES.includes(keys as never)) {
      const imported = getPreviewSkin().keymodes[keys as 4 | 6 | 7 | 8 | 9 | 10]
        ?.imported;
      if (imported) return `imported: ${imported.name}`;
      if (idbSpriteCache.get(keys)) return "imported";
    }
    return "";
  }

  async function applyDraft(draft: ManiaSkinImportDraft): Promise<void> {
    await applyImportedManiaSkin(draft, [...KEYMODES]);
    idbSpriteCache.clear();
    if (chart.kind === "ready") ensureIdbSprites(chart.columnCount);
    touchSkin();
  }

  async function importSkinFiles(files: FileList | File[]): Promise<void> {
    try {
      status.textContent = "Importing skin…";
      status.style.display = "";
      const draft = await draftFromFileList(files);
      await applyDraft(draft);
    } catch (err) {
      status.textContent = `Skin import failed — ${err instanceof Error ? err.message : String(err)}`;
      setTimeout(refreshStatus, 4000);
    }
  }

  async function exportSkinPack(): Promise<void> {
    const entries = await exportImportedSpriteDataUrls();
    if (Object.keys(entries).length === 0) {
      status.textContent = "No imported skin to export — drop an .osk first.";
      setTimeout(refreshStatus, 4000);
      return;
    }
    const skin = getPreviewSkin();
    const layouts: Record<string, unknown> = {};
    let name = "Roxysu skin";
    for (const k of KEYMODES) {
      const imported = skin.keymodes[k].imported;
      if (imported) {
        layouts[String(k)] = imported;
        name = imported.name || name;
      }
    }
    const json = JSON.stringify({ name, layouts, sprites: entries });
    const url = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "skin-pack.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    status.textContent =
      "skin-pack.json downloaded — put it next to the counter in skin/";
    setTimeout(refreshStatus, 6000);
  }

  async function resetImportedSkin(): Promise<void> {
    await resetAllImported();
    idbSpriteCache.clear();
    touchSkin();
  }


  let status_: LiveStatus = "connecting";
  let mapMeta: { title: string; version: string } | null = null;
  let chart: ChartState = { kind: "idle" };
  let lastSample: { ms: number; at: number; rate: number } | null = null;

  function currentRate(): number {
    return lastSample?.rate ?? 1;
  }

  function getTimeMs(): number {
    if (!lastSample) return 0;
    const age = performance.now() - lastSample.at;
    if (age > SAMPLE_FRESH_MS) return lastSample.ms;
    return lastSample.ms + ((performance.now() - lastSample.at) * currentRate());
  }

  function statusText(): string {
    if (status_ !== "connected") return "tosu: " + status_;
    const skin = skinLabel();
    const suffix = skin ? ` · ${skin}` : "";
    if (!mapMeta && !lastSample) return "Waiting for osu!…" + suffix;
    if (chart.kind === "loading") return "Loading chart…" + suffix;
    if (chart.kind === "not-mania") return "Not an osu!mania map" + suffix;
    if (chart.kind === "error") return `Chart error — ${chart.message}${suffix}`;
    if (chart.kind === "idle") return "Waiting for beatmap…" + suffix;
    if (mapMeta) {
      return `${mapMeta.title} [${mapMeta.version}]${suffix}`;
    }
    return suffix.replace(/^ /, "");
  }

  function refreshStatus(): void {
    const text = statusText();
    status.textContent = text;
    status.style.display = text ? "" : "none";
  }

  // --- chart loading ---------------------------------------------------------

  let pendingChecksum: string | null = null;
  let loadedChecksum: string | null = null;
  let loadedFlags: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let loadToken = 0;

  function flagsKey(acronyms: string[]): string {
    return [...acronyms].sort().join(",");
  }

  async function loadChart(acronyms: string[]): Promise<void> {
    const token = ++loadToken;
    chart = { kind: "loading" };
    refreshStatus();
    try {
      const res = await fetch("/files/beatmap/file", {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("empty file");
      const result = parseManiaNotes(text, modsFlagsFromAcronyms(acronyms));
      if (token !== loadToken) return;
      if (!result.ok) {
        chart = result.kind === "not-mania"
          ? { kind: "not-mania" }
          : { kind: "error", message: "failed to parse" };
      } else {
        chart = {
          kind: "ready",
          columnCount: result.chart.columnCount,
          notes: result.chart.notes,
        };
        ensureIdbSprites(result.chart.columnCount);
        loop?.invalidate();
      }
    } catch (err) {
      if (token !== loadToken) return;
      chart = {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    refreshStatus();
  }

  function scheduleChartLoad(checksum: string, acronyms: string[]): void {
    pendingChecksum = checksum;
    const key = flagsKey(acronyms);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (
        pendingChecksum === loadedChecksum &&
        key === loadedFlags &&
        chart.kind === "ready"
      ) {
        return;
      }
      loadedChecksum = pendingChecksum;
      loadedFlags = key;
      void loadChart(acronyms);
    }, CHART_DEBOUNCE_MS);
  }

  function onFrame(frame: LiveFrame): void {
    if (frame.timeLiveMs != null) {
      lastSample = {
        ms: frame.timeLiveMs,
        at: performance.now(),
        rate: frame.rate > 0 ? frame.rate : 1,
      };
    }
    if (frame.checksum && frame.checksum !== loadedChecksum) {
      scheduleChartLoad(frame.checksum, frame.acronyms);
    } else if (!frame.checksum && chart.kind !== "idle") {
      chart = { kind: "idle" };
      loadedChecksum = null;
      refreshStatus();
      loop?.invalidate();
    }
  }

  function onStatus(next: LiveStatus): void {
    status_ = next;
    refreshStatus();
  }

  connectLiveSocket({ onFrame, onStatus });

  // --- meta line from /json (title/version for the status line) --------------

  interface MetaJson {
    beatmap?: {
      title?: string;
      version?: string;
      time?: { live?: number };
      mode?: { number?: number };
    };
  }
  async function pollMetaOnce(): Promise<void> {
    try {
      const res = await fetch("/json", { signal: AbortSignal.timeout(4_000) });
      if (!res.ok) return;
      const data = (await res.json()) as MetaJson;
      const bm = data.beatmap;
      if (!bm) return;
      if (bm.title || bm.version) {
        mapMeta = { title: bm.title ?? "", version: bm.version ?? "" };
        refreshStatus();
      }
    } catch {
      // meta is cosmetic; ignore failures
    }
  }
  setInterval(pollMetaOnce, 5_000);
  void pollMetaOnce();

  // --- render loop -------------------------------------------------------------

  function skinFor(columnCount: number) {
    return resolveKeymodeSkin(getPreviewSkin(), columnCount);
  }

  function applySettingsToSkin(next: CounterSettings): void {
    const skin = getPreviewSkin();
    setPreviewSkin({
      ...skin,
      hitPosition: clamp(next.hitPosition, HIT_POSITION_MIN, HIT_POSITION_MAX),
      laneCover: clamp(next.laneCover, LANE_COVER_MIN, LANE_COVER_MAX),
    });
  }
  applySettingsToSkin(settings);

  let scrollSpeed = settings.scrollSpeed;

  const ctx = canvas.getContext("2d");
  let loop: ReturnType<typeof startPlayfieldRaf> | null = null;

  if (ctx) {
    function resize() {
      resizePlayfieldCanvas(canvas, ctx!, () => loop?.invalidate());
    }
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener("resize", resize);

    loop = startPlayfieldRaf({
      getTimeMs,
      snapshot: () => [
        canvas.clientWidth,
        canvas.clientHeight,
        chart.kind === "ready" ? chart.columnCount : 0,
        chart.kind === "ready" ? chart.notes : null,
        scrollSpeed,
        currentRate(),
        getPreviewSkin(),
        skinVersion,
      ],
      paint: (tMs) => {
        ctx!.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        if (chart.kind !== "ready") return;
        paintManiaNotefield({
          ctx: ctx!,
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          tMs,
          columnCount: chart.columnCount,
          notes: chart.notes,
          scrollSpeed,
          playbackRate: currentRate(),
          skin: skinFor(chart.columnCount),
          hitPosition: clamp(
            getPreviewSkin().hitPosition,
            HIT_POSITION_MIN,
            HIT_POSITION_MAX,
          ),
          laneCover: clamp(
            getPreviewSkin().laneCover,
            LANE_COVER_MIN,
            LANE_COVER_MAX,
          ),
          sprites: currentSpritesFor(chart.columnCount),
        });
      },
    });
  }

  function buildPanel(current: CounterSettings): {
    root: HTMLDivElement;
  } {
    const root = el("div", document.body);
    root.className = "panel";

    function slider(
      label: string,
      min: number,
      max: number,
      step: number,
      value: number,
      format: (v: number) => string,
      onInput: (v: number) => void,
    ): void {
      const row = el("label", root);
      row.className = "row";
      const span = el("span", row);
      span.textContent = `${label}: ${format(value)}`;
      const input = el("input", row);
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.addEventListener("input", () => {
        const v = Number(input.value);
        span.textContent = `${label}: ${format(v)}`;
        onInput(v);
      });
    }

    slider(
      "Scroll speed",
      1,
      40,
      1,
      current.scrollSpeed,
      (v) => String(v),
      (v) => {
        scrollSpeed = v;
        settings.scrollSpeed = v;
        saveCounterSettings(settings);
        loop?.invalidate();
      },
    );
    slider(
      "Hit position",
      Math.round(HIT_POSITION_MIN * 100),
      Math.round(HIT_POSITION_MAX * 100),
      1,
      Math.round(current.hitPosition * 100),
      (v) => `${v}%`,
      (v) => {
        settings.hitPosition = v / 100;
        saveCounterSettings(settings);
        applySettingsToSkin(settings);
        loop?.invalidate();
      },
    );
    slider(
      "Lane cover",
      Math.round(LANE_COVER_MIN * 100),
      Math.round(LANE_COVER_MAX * 100),
      1,
      Math.round(current.laneCover * 100),
      (v) => `${v}%`,
      (v) => {
        settings.laneCover = v / 100;
        saveCounterSettings(settings);
        applySettingsToSkin(settings);
        loop?.invalidate();
      },
    );

    const transparentRow = el("label", root);
    transparentRow.className = "row";
    const cb = el("input", transparentRow);
    cb.type = "checkbox";
    cb.checked = current.transparentBg;
    const cbSpan = el("span", transparentRow);
    cbSpan.textContent = "Transparent background";
    cb.addEventListener("change", () => {
      settings.transparentBg = cb.checked;
      saveCounterSettings(settings);
      document.body.classList.toggle("transparent", cb.checked);
    });

    const skinRow = el("div", root);
    skinRow.className = "row";
    const importBtn = el("button", skinRow);
    importBtn.type = "button";
    importBtn.textContent = "Import .osk…";
    const fileInput = el("input", skinRow);
    fileInput.type = "file";
    fileInput.accept = ".osk,.zip";
    fileInput.style.display = "none";
    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        void importSkinFiles(fileInput.files);
        fileInput.value = "";
      }
    });

    const exportBtn = el("button", skinRow);
    exportBtn.type = "button";
    exportBtn.textContent = "Export skin pack";
    exportBtn.title =
      "Download skin-pack.json — put it in a skin/ folder next to the counter so OBS uses the same imported skin.";
    exportBtn.addEventListener("click", () => void exportSkinPack());

    const resetBtn = el("button", skinRow);
    resetBtn.type = "button";
    resetBtn.textContent = "Reset imported skin";
    resetBtn.addEventListener("click", () => void resetImportedSkin());

    const hint = el("small", root);
    hint.className = "hint";
    hint.textContent =
      "Drop an .osk or skin folder anywhere on this page. A skin/skin-pack.json next to the counter overrides everything (for OBS).";

    return { root };
  }

  // --- boot ------------------------------------------------------------------

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer) void draftFromDataTransfer(e.dataTransfer).then(applyDraft).catch(() => {});
  });
  window.addEventListener("roxysu:mania-imported-skin", () => touchSkin());

  void loadFolderSkin().then((result) => {
    if (result.ok) {
      const skin = getPreviewSkin();
      const next = { ...skin, keymodes: { ...skin.keymodes } };
      for (const k of KEYMODES) {
        const layout = result.layouts[k];
        if (layout) next.keymodes[k] = { ...next.keymodes[k], imported: layout };
      }
      setPreviewSkin(next);
    }
    if (chart.kind === "ready") ensureIdbSprites(chart.columnCount);
    touchSkin();
  });

  refreshStatus();
}

main();
