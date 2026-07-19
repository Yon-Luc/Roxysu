import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./global.css";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

if ("serviceWorker" in navigator) {
	void navigator.serviceWorker.register("/sw.js");
}
