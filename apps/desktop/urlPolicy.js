"use strict";

/**
 * Pure URL checks for the Electron shell. The window may stay on the app
 * origin only; http(s) and osu: links go to the OS. No Electron imports.
 */

/**
 * @param {string} host
 * @param {number | string} port
 */
function appOrigin(host, port) {
  return `http://${host}:${port}`;
}

/**
 * @param {string} url
 * @param {string} origin
 */
function isAppUrl(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Schemes the OS may open. file: and javascript: stay closed.
 * @param {string} url
 */
function canOpenExternal(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "osu:";
  } catch {
    return false;
  }
}

/**
 * @param {string | null | undefined} frameUrl
 * @param {string} origin
 */
function senderIsApp(frameUrl, origin) {
  return typeof frameUrl === "string" && frameUrl.length > 0 && isAppUrl(frameUrl, origin);
}

/**
 * Origin + pathname only. Drops userinfo, search, and hash so tokens and
 * search terms never land in desktop.log. Unparseable input becomes
 * "[invalid-url]". file: URLs become `file:` + pathname (origin is "null").
 * @param {unknown} url
 * @returns {string}
 */
function redactUrlForLog(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return "[invalid-url]";
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") {
      return `file:${parsed.pathname}`;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

module.exports = {
  appOrigin,
  isAppUrl,
  canOpenExternal,
  senderIsApp,
  redactUrlForLog,
};
