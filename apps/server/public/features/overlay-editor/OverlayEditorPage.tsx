import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  deleteOverlayProfile,
  fetchOverlayProfiles,
  putOverlayProfile,
  type OverlayElementInstance,
  type OverlayProfile,
} from "../../lib/api";
import { pushToast } from "../../lib/toasts";
import { useAppDict } from "../../lib/i18n";
import { useTosuLiveQuery } from "../../lib/useTosuLiveQuery";
import { fetchOverlay } from "../../lib/api";
import { OverlayStage, useFitScale } from "../overlay/OverlayStage";
import type { OverlayElementContext } from "../overlay/OverlayElements";
import {
  OVERLAY_ELEMENT_DEFS,
  SIZE_PRESETS,
  TRIGGER_FIELD_LABELS,
  clampPreviewHeightRem,
  clampProfileSize,
  clampScale,
  clampScoreListLimit,
  identityOptions,
  makeElement,
  makeProfile,
} from "../overlay/profileModel";

const EDGE_REVEAL_PX = 36;

const TRIGGER_VALUE_LABELS: Record<string, Record<string, string>> = {
  "play.active": { true: "Playing", false: "Not playing" },
  status: {
    disabled: "Disabled",
    connecting: "Connecting",
    connected: "Connected",
    disconnected: "Disconnected",
  },
  connected: { true: "Yes", false: "No" },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-faint">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      className="rx-input w-full"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

/** Floating editor layer marker: revealed whenever the cursor touches a screen edge or the layer. */
function UiLayer({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={`absolute z-20 ${className}`} data-ui-layer>
      {children}
    </div>
  );
}

export function OverlayEditorPage() {
  const { dict } = useAppDict();
  const queryClient = useQueryClient();

  const profilesQuery = useQuery({
    queryKey: ["overlay", "profiles"],
    queryFn: fetchOverlayProfiles,
  });
  const profiles = profilesQuery.data?.profiles ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OverlayProfile | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null,
  );
  const [fitMode, setFitMode] = useState(false);
  const [uiVisible, setUiVisible] = useState(false);
  const draggingRef = useRef(false);

  // Editor chrome stays out of the way; touching any screen edge or hovering
  // a revealed layer keeps it visible.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const overUi =
        e.target instanceof Element &&
        e.target.closest("[data-ui-layer]") != null;
      const atEdge =
        e.clientX <= EDGE_REVEAL_PX ||
        e.clientX >= window.innerWidth - EDGE_REVEAL_PX ||
        e.clientY <= EDGE_REVEAL_PX ||
        e.clientY >= window.innerHeight - EDGE_REVEAL_PX;
      // While dragging an element the chrome stays hidden so it never blocks
      // the drop target.
      setUiVisible(!draggingRef.current && (atEdge || overUi));
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const activeProfile = useMemo(() => {
    return profiles.find((p) => p.id === selectedId) ?? profiles[0] ?? null;
  }, [profiles, selectedId]);

  // Load the draft when switching profiles.
  const [draftForId, setDraftForId] = useState<string | null>(null);
  if (activeProfile && draftForId !== activeProfile.id) {
    setDraftForId(activeProfile.id);
    setDraft(structuredClone(activeProfile));
    setSelectedInstanceId(null);
  }
  if (!activeProfile && draft !== null) {
    setDraft(null);
    setDraftForId(null);
  }

  const saveMutation = useMutation({
    mutationFn: async (profile: OverlayProfile) => {
      const result = await putOverlayProfile(profile);
      if (result instanceof Response || !("profile" in result) || !result.profile) {
        throw new Error("Saving overlay profile failed");
      }
      return result;
    },
    onSuccess: (result) => {
      setDraft(structuredClone(result.profile));
      setDraftForId(result.profile.id);
      setSelectedId(result.profile.id);
      queryClient.invalidateQueries({ queryKey: ["overlay", "profiles"] });
      pushToast({
        title:
          dict?.overlayEditor?.saved ??
          `Profile "${result.profile.name}" saved`,
        tone: "success",
      });
    },
    onError: (error) =>
      pushToast({ title: String(error), tone: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOverlayProfile(id),
    onSuccess: () => {
      setSelectedId(null);
      setDraft(null);
      setDraftForId(null);
      queryClient.invalidateQueries({ queryKey: ["overlay", "profiles"] });
    },
  });

  const snapshotQuery = useTosuLiveQuery();
  const previewOverlayQuery = useQuery({
    queryKey: ["overlay-editor-preview"],
    queryFn: () => fetchOverlay(8),
    refetchIntervalInBackground: true,
    networkMode: "always",
    refetchInterval: 8_000,
    staleTime: 0,
  });

  const patchDraft = useCallback((patch: Partial<OverlayProfile>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const updateElement = useCallback(
    (instanceId: string, patch: Partial<OverlayElementInstance>) => {
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              elements: prev.elements.map((el) =>
                el.instanceId === instanceId ? { ...el, ...patch } : el,
              ),
            }
          : prev,
      );
    },
    [],
  );

  const addElement = useCallback(
    (type: (typeof OVERLAY_ELEMENT_DEFS)[number]["type"]) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const offset = prev.elements.length * 24;
        return {
          ...prev,
          elements: [
            ...prev.elements,
            makeElement(type, 40 + (offset % 240), 40 + (offset % 180)),
          ],
        };
      });
    },
    [],
  );

  const removeElement = useCallback((instanceId: string) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            elements: prev.elements.filter((el) => el.instanceId !== instanceId),
          }
        : prev,
    );
    setSelectedInstanceId((prev) => (prev === instanceId ? null : prev));
  }, []);

  const canvasWrap = useFitScale(draft?.width ?? 1920);
  const activeScale = fitMode ? canvasWrap.scale || 1 : 1;

  const handleElementPointerDown = useCallback(
    (element: OverlayElementInstance, event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedInstanceId(element.instanceId);
      draggingRef.current = true;
      setUiVisible(false);
      const start = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: element.x,
        originY: element.y,
      };
      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== start.pointerId) return;
        const nextX = Math.round(
          start.originX + (moveEvent.clientX - start.startX) / activeScale,
        );
        const nextY = Math.round(
          start.originY + (moveEvent.clientY - start.startY) / activeScale,
        );
        updateElement(element.instanceId, { x: nextX, y: nextY });
      };
      const onUp = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [activeScale, updateElement],
  );

  const ctx: OverlayElementContext = useMemo(
    () => ({
      bg: draft?.bg ?? "clear",
      mode: previewOverlayQuery.data?.mode ?? "empty",
      scores: previewOverlayQuery.data?.scores ?? [],
      freshIds: new Set<string>(),
      session: previewOverlayQuery.data?.session ?? null,
      snapshot: snapshotQuery.data ?? null,
    }),
    [draft?.bg, previewOverlayQuery.data, snapshotQuery.data],
  );

  const consumerUrl =
    draft != null
      ? `${window.location.origin}${window.location.pathname}#/overlay?bg=${draft.bg}&limit=25&profile=${encodeURIComponent(draft.name)}`
      : "";

  const selectedElement =
    draft?.elements.find((el) => el.instanceId === selectedInstanceId) ?? null;

  return (
    <div className="fixed inset-0 select-none bg-[#0b0d10] text-white">
      {/* Canvas at the profile's real pixel size */}
      <div
        className="absolute inset-0 overflow-auto"
        onPointerDown={() => setSelectedInstanceId(null)}
      >
        {draft ? (
          <div className="flex min-h-full w-max min-w-full items-center justify-center p-12">
            <div className="ring-1 ring-white/15">
              <OverlayStage
                profile={draft}
                ctx={ctx}
                scale={fitMode ? canvasWrap.scale : 1}
                interactive
                selectedInstanceId={selectedInstanceId}
                onElementPointerDown={handleElementPointerDown}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-white/50">
            <span>No overlay profile yet.</span>
            <button
              type="button"
              className="rx-btn-primary !px-4 !py-1.5 text-xs"
              onClick={() => saveMutation.mutate(makeProfile("New overlay"))}
            >
              Create overlay profile
            </button>
          </div>
        )}
      </div>

      {/* Revealed editor chrome */}
      {uiVisible && draft ? (
        <>
          {/* Toolbar */}
          <UiLayer className="inset-x-0 top-0 border-b border-white/10 bg-[#0b0d10]/95 px-3 py-2 backdrop-blur">
            <div
              className="flex flex-wrap items-center gap-2"
            >
              <Link
                to="/"
                className="rx-btn !px-3 !py-1 text-xs"
                aria-label="Back"
              >
                ←
              </Link>
              <span className="mr-2 text-xs font-bold uppercase tracking-wide text-white/60">
                Overlay editor
              </span>
              <select
                className="rx-input max-w-48 py-1 text-xs"
                value={activeProfile?.id ?? ""}
                onChange={(e) => setSelectedId(e.target.value || null)}
              >
                {profiles.length === 0 ? <option value="">—</option> : null}
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rx-btn !px-3 !py-1 text-xs"
                onClick={() => {
                  const profile = makeProfile("New overlay");
                  saveMutation.mutate(profile);
                }}
              >
                New
              </button>
              <button
                type="button"
                className="rx-btn !px-3 !py-1 text-xs"
                disabled={!draft}
                onClick={() => {
                  if (!draft) return;
                  const copy = structuredClone(draft);
                  copy.id = `profile-${Math.random().toString(36).slice(2, 10)}`;
                  copy.name = `${draft.name} copy`;
                  saveMutation.mutate(copy);
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="rx-btn-primary !px-3 !py-1 text-xs"
                disabled={!draft}
                onClick={() => draft && saveMutation.mutate(draft)}
              >
                Save
              </button>
              <button
                type="button"
                className="rx-btn !px-3 !py-1 text-xs text-danger"
                disabled={!draft || deleteMutation.isPending}
                onClick={() => draft && deleteMutation.mutate(draft.id)}
              >
                Delete
              </button>
              {consumerUrl ? (
                <button
                  type="button"
                  className="rx-btn !px-3 !py-1 text-xs"
                  onClick={() => navigator.clipboard.writeText(consumerUrl)}
                  title={consumerUrl}
                >
                  Copy URL
                </button>
              ) : null}
              <button
                type="button"
                className="rx-btn ml-auto !px-3 !py-1 text-xs"
                onClick={() => setFitMode((v) => !v)}
              >
                {fitMode ? "Actual size (1:1)" : `Fit view (${draft.width}×${draft.height})`}
              </button>
            </div>
          </UiLayer>

          {/* Palette + layers */}
          <UiLayer className="bottom-3 left-3 top-14 w-56 overflow-y-auto">
            <div className="flex flex-col gap-3">
              <section className="rx-panel p-3">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">
                  Elements
                </h3>
                <div className="grid gap-1">
                  {OVERLAY_ELEMENT_DEFS.map((def) => (
                    <button
                      key={def.type}
                      type="button"
                      className="rx-btn justify-start !px-2 !py-1 text-left text-xs"
                      onClick={() => addElement(def.type)}
                      title={def.hint}
                    >
                      + {def.label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="rx-panel p-3">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">
                  Layers
                </h3>
                <ul className="flex flex-col gap-1">
                  {[...draft.elements].reverse().map((el) => (
                    <li key={el.instanceId}>
                      <div
                        className={`flex items-center gap-1 rounded px-2 py-1 text-sm ${
                          selectedInstanceId === el.instanceId
                            ? "bg-accent/15 text-accent"
                            : "hover:bg-surface"
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left text-xs capitalize"
                          onClick={() => setSelectedInstanceId(el.instanceId)}
                        >
                          {OVERLAY_ELEMENT_DEFS.find((d) => d.type === el.type)
                            ?.label ?? el.type}
                          {el.trigger ? " ⚡" : ""}
                        </button>
                        <button
                          type="button"
                          aria-label="Remove element"
                          className="px-1 text-faint hover:text-danger"
                          onClick={() => removeElement(el.instanceId)}
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                  {draft.elements.length === 0 ? (
                    <li className="px-2 py-1 text-xs text-faint">Empty</li>
                  ) : null}
                </ul>
              </section>
            </div>
          </UiLayer>

          {/* Inspector */}
          <UiLayer className="bottom-3 right-3 top-14 w-80 overflow-y-auto">
            <div className="flex flex-col gap-3">
              <section className="rx-panel space-y-3 p-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-faint">
                  Profile
                </h3>
                <Field label="Name">
                  <input
                    className="rx-input w-full"
                    value={draft.name}
                    onChange={(e) => patchDraft({ name: e.target.value })}
                  />
                </Field>
                <Field label="Size preset">
                  <select
                    className="rx-input w-full"
                    onChange={(e) => {
                      const preset = SIZE_PRESETS.find(
                        (p) => p.label === e.target.value,
                      );
                      if (preset) {
                        patchDraft({
                          width: preset.width,
                          height: preset.height,
                        });
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {SIZE_PRESETS.map((p) => (
                      <option key={p.label} value={p.label}>
                        {p.label} ({p.width}×{p.height})
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Width">
                    <NumberInput
                      value={draft.width}
                      min={320}
                      max={7680}
                      onChange={(width) =>
                        patchDraft({ width: clampProfileSize(width) })
                      }
                    />
                  </Field>
                  <Field label="Height">
                    <NumberInput
                      value={draft.height}
                      min={320}
                      max={7680}
                      onChange={(height) =>
                        patchDraft({ height: clampProfileSize(height) })
                      }
                    />
                  </Field>
                </div>
                <Field label="Background">
                  <select
                    className="rx-input w-full"
                    value={draft.bg}
                    onChange={(e) =>
                      patchDraft({
                        bg: e.target.value === "solid" ? "solid" : "clear",
                      })
                    }
                  >
                    <option value="clear">Clear</option>
                    <option value="solid">Solid</option>
                  </select>
                </Field>
              </section>

              {selectedElement ? (
                <section className="rx-panel space-y-3 p-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-faint">
                    Element · {selectedElement.type}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="X">
                      <NumberInput
                        value={selectedElement.x}
                        onChange={(x) =>
                          updateElement(selectedElement.instanceId, { x })
                        }
                      />
                    </Field>
                    <Field label="Y">
                      <NumberInput
                        value={selectedElement.y}
                        onChange={(y) =>
                          updateElement(selectedElement.instanceId, { y })
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    label={`Scale (${clampScale(selectedElement.scale).toFixed(2)}×)`}
                  >
                    <input
                      type="range"
                      min={0.25}
                      max={4}
                      step={0.05}
                      value={selectedElement.scale}
                      onChange={(e) =>
                        updateElement(selectedElement.instanceId, {
                          scale: clampScale(Number(e.target.value)),
                        })
                      }
                      className="w-full"
                    />
                  </Field>

                  {selectedElement.type === "scoreList" ? (
                    <Field label="Score limit">
                      <NumberInput
                        value={clampScoreListLimit(
                          selectedElement.options?.limit,
                        )}
                        min={1}
                        max={25}
                        onChange={(limit) =>
                          updateElement(selectedElement.instanceId, {
                            options: {
                              ...selectedElement.options,
                              limit: clampScoreListLimit(limit),
                            },
                          })
                        }
                      />
                    </Field>
                  ) : null}

                  {selectedElement.type === "identity" ? (
                    <>
                      <label className="flex items-center gap-2 text-xs text-white/80">
                        <input
                          type="checkbox"
                          checked={identityOptions(selectedElement.options).showAnalysis}
                          onChange={(e) =>
                            updateElement(selectedElement.instanceId, {
                              options: {
                                ...identityOptions(selectedElement.options),
                                showAnalysis: e.target.checked,
                              },
                            })
                          }
                        />
                        Show analysis
                      </label>
                      {identityOptions(selectedElement.options).showAnalysis ? (
                        <>
                          <Field label="Rating source">
                            <select
                              className="rx-input w-full"
                              value={
                                identityOptions(selectedElement.options)
                                  .ratingSource
                              }
                              onChange={(e) =>
                                updateElement(selectedElement.instanceId, {
                                  options: {
                                    ...identityOptions(selectedElement.options),
                                    ratingSource:
                                      e.target.value === "star"
                                        ? ("star" as const)
                                        : ("dan" as const),
                                  },
                                })
                              }
                            >
                              <option value="dan">Sunny dan</option>
                              <option value="star">Star rating</option>
                            </select>
                          </Field>
                          <label className="flex items-center gap-2 text-xs text-white/80">
                            <input
                              type="checkbox"
                              checked={
                                identityOptions(selectedElement.options)
                                  .showPattern
                              }
                              onChange={(e) =>
                                updateElement(selectedElement.instanceId, {
                                  options: {
                                    ...identityOptions(
                                      selectedElement.options,
                                    ),
                                    showPattern: e.target.checked,
                                  },
                                })
                              }
                            />
                            Show pattern
                          </label>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {selectedElement.type === "preview" ? (
                    <Field label="Preview height (rem)">
                      <NumberInput
                        value={clampPreviewHeightRem(
                          selectedElement.options?.previewHeightRem,
                        )}
                        min={18}
                        max={52}
                        onChange={(heightRem) =>
                          updateElement(selectedElement.instanceId, {
                            options: {
                              ...selectedElement.options,
                              previewHeightRem:
                                clampPreviewHeightRem(heightRem),
                            },
                          })
                        }
                      />
                    </Field>
                  ) : null}

                  <div className="rounded-lg border border-white/10 p-2">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
                      Trigger (tosu live)
                    </div>
                    <div className="space-y-2">
                      <select
                        className="rx-input w-full"
                        value={selectedElement.trigger?.field ?? ""}
                        onChange={(e) => {
                          const field = e.target.value;
                          updateElement(selectedElement.instanceId, {
                            trigger:
                              field === ""
                                ? null
                                : {
                                    field: field as
                                      | "play.active"
                                      | "status"
                                      | "connected",
                                    op: "is",
                                    value:
                                      field === "status" ? "connected" : true,
                                    action: "hide",
                                  },
                          });
                        }}
                      >
                        <option value="">Always visible</option>
                        {Object.entries(TRIGGER_FIELD_LABELS).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              When {label.toLowerCase()}…
                            </option>
                          ),
                        )}
                      </select>
                      {selectedElement.trigger ? (
                        <>
                          <select
                            className="rx-input w-full"
                            value={
                              selectedElement.trigger.op +
                              ":" +
                              String(selectedElement.trigger.value)
                            }
                            onChange={(e) => {
                              const [op, rawValue] = e.target.value.split(":");
                              const isBool =
                                selectedElement.trigger!.field !== "status";
                              updateElement(selectedElement.instanceId, {
                                trigger: {
                                  ...selectedElement.trigger!,
                                  op: op as "is" | "isNot",
                                  value: isBool
                                    ? rawValue === "true"
                                    : rawValue,
                                },
                              });
                            }}
                          >
                            {(
                              TRIGGER_VALUE_LABELS[
                                selectedElement.trigger.field
                              ] ?? {}
                            )[String(true)] != null &&
                            selectedElement.trigger.field !== "status"
                              ? (["true", "false"] as const).map((b) => (
                                  <option
                                    key={b}
                                    value={`${selectedElement.trigger!.op}:${b}`}
                                  >
                                    {selectedElement.trigger!.op === "is"
                                      ? "is"
                                      : "is not"}{" "}
                                    {
                                      TRIGGER_VALUE_LABELS[
                                        selectedElement.trigger!.field
                                      ][b]
                                    }
                                  </option>
                                ))
                              : Object.entries(
                                  TRIGGER_VALUE_LABELS[
                                    selectedElement.trigger.field
                                  ] ?? {},
                                ).map(([value, label]) => (
                                  <option
                                    key={value}
                                    value={`${selectedElement.trigger!.op}:${value}`}
                                  >
                                    {selectedElement.trigger!.op === "is"
                                      ? "is"
                                      : "is not"}{" "}
                                    {label}
                                  </option>
                                ))}
                          </select>
                          <select
                            className="rx-input w-full"
                            value={selectedElement.trigger.action}
                            onChange={(e) =>
                              updateElement(selectedElement.instanceId, {
                                trigger: {
                                  ...selectedElement.trigger!,
                                  action: e.target
                                    .value as "hide" | "show" | "fade",
                                },
                              })
                            }
                          >
                            <option value="hide">…hide it</option>
                            <option value="show">…show it</option>
                            <option value="fade">…fade it</option>
                          </select>
                        </>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : (
                <section className="rx-panel p-3 text-xs text-faint">
                  Click an element on the canvas to edit it; click empty space
                  to deselect.
                </section>
              )}
            </div>
          </UiLayer>
        </>
      ) : null}

      {!uiVisible && draft ? (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/50">
          Touch a screen edge to show the editor
        </div>
      ) : null}
    </div>
  );
}
