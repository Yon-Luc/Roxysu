import type { PlayfieldSkin } from "./PlayfieldSkin";

export const DEFAULT_PLAYFIELD_SKIN: PlayfieldSkin = {
  id: "roxysu-default",
  name: "Roxysu Default",
  laneColors: [
    "#7dd3fc",
    "#93c5fd",
    "#6ee7b7",
    "#67e8f9",
    "#a78bfa",
    "#f9a8d4",
    "#fcd34d",
  ],
  laneBackgroundEven: "#0b0e13",
  laneBackgroundOdd: "#0e1117",
  playfieldBackground: "#080a0e",
  belowReceptorBackground: "#11151d",
  receptorFill: "#252d3a",
  receptorHeight: 22,
  judgmentLineColor: "#3b82f6",
  noteBorderRadius: 4,
  notePadding: 4,
  judgmentColors: {
    perfect: "#a78bfa",
    great: "#34d399",
    good: "#60a5fa",
    ok: "#fbbf24",
    meh: "#fb923c",
  },
  judgmentMissColor: "#f87171",
};
