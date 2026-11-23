"use strict";

/**
 * Splash status strings for the four client-app languages. The shell picks
 * by app.getLocale(); the splash page uses the same table for first paint.
 * No Electron imports.
 */

/** @typedef {"starting" | "waiting" | "opening" | "restarting"} SplashStatusKey */

/** @type {Record<"en" | "fr" | "es" | "pt", Record<SplashStatusKey, string>>} */
const SPLASH_STATUS = {
  en: {
    starting: "Starting",
    waiting: "Waiting for server",
    opening: "Opening Home",
    restarting: "Server stopped — restarting",
  },
  fr: {
    starting: "Démarrage",
    waiting: "Attente du serveur",
    opening: "Ouverture de l'accueil",
    restarting: "Serveur arrêté — redémarrage",
  },
  es: {
    starting: "Iniciando",
    waiting: "Esperando al servidor",
    opening: "Abriendo Inicio",
    restarting: "Servidor detenido — reiniciando",
  },
  pt: {
    starting: "Iniciando",
    waiting: "Aguardando o servidor",
    opening: "Abrindo o Início",
    restarting: "Servidor parado — reiniciando",
  },
};

/**
 * Primary language of an Electron / BCP-47 tag. Unknown tags fall back to en.
 * @param {unknown} locale
 * @returns {"en" | "fr" | "es" | "pt"}
 */
function splashLang(locale) {
  const tag = typeof locale === "string" ? locale.toLowerCase() : "";
  const primary = tag.split("-")[0];
  if (primary === "fr" || primary === "es" || primary === "pt") return primary;
  return "en";
}

/**
 * @param {unknown} locale
 * @param {SplashStatusKey} key
 * @returns {string}
 */
function splashStatus(locale, key) {
  const table = SPLASH_STATUS[splashLang(locale)];
  return table[key] || SPLASH_STATUS.en[key];
}

module.exports = { SPLASH_STATUS, splashLang, splashStatus };
