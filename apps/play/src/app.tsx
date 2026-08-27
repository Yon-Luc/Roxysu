import { useState } from "react";
import { render } from "@gpuix/react";

const bg = "#0c0e12";
const surface = "#161a22";
const surfaceHover = "#1e2430";
const accent = "#7dd3fc";
const text = "#e8eef7";
const muted = "#8b95a8";

function App() {
  const [count, setCount] = useState(0);

  return (
    <div
      style={{
        height: "100%",
        backgroundColor: bg,
        display: "flex",
        flexDirection: "column",
        padding: 32,
        gap: 24,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <text style={{ color: accent, fontSize: 14, fontWeight: 600 }}>
          ROXYSU
        </text>
        <text style={{ color: text, fontSize: 32, fontWeight: 700 }}>
          Play
        </text>
        <text style={{ color: muted, fontSize: 15 }}>
          Native GPU UI via GPUIX — no Electron, no web view.
        </text>
      </div>

      <div
        onClick={() => setCount((c) => c + 1)}
        style={{
          alignSelf: "flex-start",
          padding: 16,
          borderRadius: 10,
          cursor: "pointer",
          backgroundColor: surface,
          hover: { backgroundColor: surfaceHover },
          active: { backgroundColor: "#252b38" },
        }}
      >
        <text style={{ color: text, fontSize: 16 }}>
          Clicked {count} time{count === 1 ? "" : "s"}
        </text>
      </div>

      <text style={{ color: muted, fontSize: 13 }}>
        Save this file while running `bun run dev` to remount on the same window.
      </text>
    </div>
  );
}

render(<App />, {
  title: "Roxysu Play",
  appName: "Roxysu Play",
  width: 880,
  height: 560,
  titlebarTransparent: true,
  windowBackground: "opaque",
});
