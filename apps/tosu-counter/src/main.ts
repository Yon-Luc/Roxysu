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
import { connectTosuSettings } from "./tosuSettings";
import {
  drawWatermark,
  loadWatermarkLogo,
  watermarkSettled,
} from "./watermark";

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

  // Dashboard-editable settings via tosu's counter settings API. These win
  // over URL params / localStorage once received — explicit user intent.
  connectTosuSettings({
    onValues: (values) => {
      let changed = false;
      if (typeof values["scrollSpeed"] === "number") {
        const v = Math.round(values["scrollSpeed"]);
        if (v !== settings.scrollSpeed) {
          settings.scrollSpeed = v;
          scrollSpeed = v;
          changed = true;
        }
      }
      for (const [id, key] of [
        ["hitPosition", "hitPosition"],
        ["laneCover", "laneCover"],
      ] as const) {
        if (typeof values[id] === "number") {
          const frac = values[id] > 1 ? values[id] / 100 : values[id];
          if (frac !== settings[key]) {
            settings[key] = frac;
            changed = true;
          }
        }
      }
      if (typeof values["transparentBg"] === "boolean") {
        if (values["transparentBg"] !== settings.transparentBg) {
          settings.transparentBg = values["transparentBg"];
          document.body.classList.toggle("transparent", settings.transparentBg);
          changed = true;
        }
      }
      if (typeof values["showWatermark"] === "boolean") {
        if (values["showWatermark"] !== settings.showWatermark) {
          settings.showWatermark = values["showWatermark"];
          changed = true;
        }
      }
      if (typeof values["idlePreview"] === "boolean") {
        if (values["idlePreview"] !== settings.idlePreview) {
          settings.idlePreview = values["idlePreview"];
          changed = true;
        }
      }
      if (changed) {
        saveCounterSettings(settings);
        applySettingsToSkin(settings);
        panel.syncFrom();
      }
      // Always repaint on a dashboard frame for this counter — even when the
      // delivered values equal what we already have. In tosu's embedded
      // preview the render loop is suspended until the iframe is activated
      // (focus/visibility), so a settings interaction was the only thing that
      // ever forced a repaint; applying values on load (getSettings retry)
      // removed that trigger, leaving the canvas blank. Forcing a repaint here
      // restores "save settings → preview updates" regardless of change.
      touchSkin();
    },
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
  let liveErrorCount = 0;
  let lastFrameAt = 0;
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
    // Live-feed health: how long since the last v2 frame / socket error count.
    // Surfaces connection problems that would otherwise look like a freeze.
    const sinceFrame = lastFrameAt ? Math.round((performance.now() - lastFrameAt) / 1000) : null;
    const feed = sinceFrame == null
      ? "no frames"
      : sinceFrame > 3
        ? `feed ${sinceFrame}s stale`
        : "";
    const feedTag = feed ? ` · ${feed}` : liveErrorCount ? ` · ${liveErrorCount} ws err` : "";
    if (!mapMeta && !lastSample) {
      if (settings.idlePreview) {
        return (sinceFrame == null ? "Song select (no osu link)" : "Song select") + suffix + feedTag;
      }
      return "Waiting for osu!…" + suffix + feedTag;
    }
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
        lastColumnCount = result.chart.columnCount;
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
    lastFrameAt = performance.now();
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
    } else {
      // Any frame (even without time/checksum) proves the live feed is alive.
      refreshStatus();
    }
  }

  function onStatus(next: LiveStatus): void {
    status_ = next;
    refreshStatus();
  }

  connectLiveSocket({
    onFrame,
    onStatus,
    onError: () => {
      liveErrorCount += 1;
      refreshStatus();
    },
  });

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
  let lastColumnCount = 4;

  const ctx = canvas.getContext("2d");
  let loop: ReturnType<typeof startPlayfieldRaf> | null = null;

  function paintNotefield(tMs: number, columnCount: number, notes: PreviewNote[] | null): void {
    paintManiaNotefield({
      ctx: ctx!,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      tMs,
      columnCount,
      notes: notes ?? [],
      scrollSpeed,
      playbackRate: currentRate(),
      skin: skinFor(columnCount),
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
      sprites: currentSpritesFor(columnCount),
    });
  }

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
        chart.kind === "ready" ? chart.columnCount : lastColumnCount,
        chart.kind === "ready" ? chart.notes : null,
        scrollSpeed,
        currentRate(),
        getPreviewSkin(),
        skinVersion,
        watermarkSettled(),
        settings.idlePreview,
      ],
      paint: (tMs) => {
        ctx!.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        if (chart.kind === "ready") {
          paintNotefield(tMs, chart.columnCount, chart.notes);
        } else if (settings.idlePreview) {
          // Song-select / idle preview: show the playfield (receptors, lane
          // cover, imported skin) with no notes so the skin is visible before
          // a beatmap is loaded.
          paintNotefield(tMs, lastColumnCount, null);
        }
        if (settings.showWatermark) {
          drawWatermark(ctx!, canvas.clientWidth, canvas.clientHeight);
        }
      },
    });
  }

  function buildPanel(current: CounterSettings): {
    root: HTMLDivElement;
    syncFrom: () => void;
  } {
    const root = el("div", document.body);
    root.className = "panel";
    const syncers: Array<() => void> = [];

    function slider(
      label: string,
      min: number,
      max: number,
      step: number,
      get: () => number,
      format: (v: number) => string,
      onInput: (v: number) => void,
    ): void {
      const row = el("label", root);
      row.className = "row";
      const span = el("span", row);
      const input = el("input", row);
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      const render = () => {
        span.textContent = `${label}: ${format(Number(input.value))}`;
      };
      input.value = String(get());
      render();
      input.addEventListener("input", () => {
        render();
        onInput(Number(input.value));
      });
      syncers.push(() => {
        if (document.activeElement !== input) {
          input.value = String(get());
        }
        render();
      });
    }

    slider(
      "Scroll speed",
      1,
      40,
      1,
      () => settings.scrollSpeed,
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
      () => Math.round(settings.hitPosition * 100),
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
      () => Math.round(settings.laneCover * 100),
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
    const cbSpan = el("span", transparentRow);
    cbSpan.textContent = "Transparent background";
    cb.checked = settings.transparentBg;
    cb.addEventListener("change", () => {
      settings.transparentBg = cb.checked;
      saveCounterSettings(settings);
      document.body.classList.toggle("transparent", cb.checked);
    });
    syncers.push(() => {
      if (document.activeElement !== cb) cb.checked = settings.transparentBg;
    });

    const wmRow = el("label", root);
    wmRow.className = "row";
    const wmCb = el("input", wmRow);
    wmCb.type = "checkbox";
    const wmSpan = el("span", wmRow);
    wmSpan.textContent = "Roxysu watermark";
    wmCb.checked = settings.showWatermark;
    wmCb.addEventListener("change", () => {
      settings.showWatermark = wmCb.checked;
      saveCounterSettings(settings);
      loop?.invalidate();
    });
    syncers.push(() => {
      if (document.activeElement !== wmCb) wmCb.checked = settings.showWatermark;
    });

    const idleRow = el("label", root);
    idleRow.className = "row";
    const idleCb = el("input", idleRow);
    idleCb.type = "checkbox";
    const idleSpan = el("span", idleRow);
    idleSpan.textContent = "Song-select preview";
    idleCb.checked = settings.idlePreview;
    idleCb.addEventListener("change", () => {
      settings.idlePreview = idleCb.checked;
      saveCounterSettings(settings);
      loop?.invalidate();
    });
    syncers.push(() => {
      if (document.activeElement !== idleCb) idleCb.checked = settings.idlePreview;
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
      "Drop an .osk or skin folder anywhere. Settings live in the tosu dashboard (after a refresh) and here; URL params ?scroll=24&hitpos=88&cover=30&transparent=1 also work.";

    return {
      root,
      syncFrom: () => {
        for (const sync of syncers) sync();
      },
    };
  }

  // --- boot ------------------------------------------------------------------

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer) void draftFromDataTransfer(e.dataTransfer).then(applyDraft).catch(() => {});
  });
  window.addEventListener("roxysu:mania-imported-skin", () => touchSkin());

  loadWatermarkLogo();

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
  // Force an immediate paint so the idle/song-select preview is visible as
  // soon as tosu shows the counter — don't wait for a heartbeat or a
  // dashboard settings update (both of which were the only things that
  // repainted before).
  loop?.invalidate();

  // In tosu's embedded preview the render loop (rAF + interval) is often
  // suspended until the iframe is actually shown/activated. Repaint on the
  // events that mean "now visible/active" so the preview appears without a
  // manual nudge.
  const repaintNow = () => loop?.invalidate();
  for (const ev of ["load", "pageshow", "focus", "resize"] as const) {
    window.addEventListener(ev, repaintNow);
  }
  document.addEventListener("visibilitychange", repaintNow);
}

main();
