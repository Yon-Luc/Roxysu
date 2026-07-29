import { createRoot } from "react-dom/client";
import { App } from "./app";
import { applyTheme, getTheme } from "./lib/theme";
import "./global.css";

applyTheme(getTheme());

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

if ("serviceWorker" in navigator && !(window as { roxysuDesktop?: unknown }).roxysuDesktop) {
	void navigator.serviceWorker.register("/sw.js");
}
