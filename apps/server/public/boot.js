/*
 * Pre-paint bootstrap for the Roxysu client app (L2).
 *
 * Extracted from two inline <script> blocks in index.html so a strict CSP
 * (`script-src 'self'`) can be adopted without 'unsafe-inline'. This file is
 * referenced with a plain blocking `<script src="./boot.js">` in <head>: it
 * must run before first paint, so do not add `defer`/`async`, and do not load
 * anything else from here.
 *
 * Both blocks are failure-tolerant on purpose (private browsing / blocked
 * storage throw on localStorage) and must never break rendering.
 */

// Match the persisted locale before first paint so the initial lang attribute
// is not always English (React also corrects it on mount).
// Mirrors lib/language.ts: localStorage "roxysu:language".
try {
	var savedLang = localStorage.getItem("roxysu:language");
	if (savedLang === "en" || savedLang === "es" || savedLang === "fr" || savedLang === "pt") {
		document.documentElement.lang = savedLang;
	}
} catch (e) {}

// Overlay mode + persisted theme, both before paint: the overlay route needs a
// visually transparent page (WebKitGTK layer-shell surface) and the theme class
// must be on <html> so there is no flash of the wrong palette.
try {
	var hashPath = (location.hash || "").replace(/^#/, "").split("?")[0];
	if (hashPath === "/overlay") {
		document.documentElement.classList.add("overlay-mode");
		document.documentElement.style.background = "transparent";
		document.addEventListener("DOMContentLoaded", function () {
			if (document.body) document.body.style.background = "transparent";
		});
	}
	var mode = localStorage.getItem("roxysu:theme");
	var light = false;
	if (mode === "light") light = true;
	else if (mode === "system") {
		light = window.matchMedia("(prefers-color-scheme: light)").matches;
	}
	if (light) {
		document.documentElement.classList.add("light");
		document.querySelector('meta[name="theme-color"]').content = "#f5f5f5";
	}
} catch (e) {}
