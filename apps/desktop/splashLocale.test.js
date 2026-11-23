import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { splashLang, splashStatus } = require("./splashLocale.js");

describe("splashLocale", () => {
  test("picks the four client-app languages and falls back to English", () => {
    expect(splashLang("en-US")).toBe("en");
    expect(splashLang("fr")).toBe("fr");
    expect(splashLang("fr-CA")).toBe("fr");
    expect(splashLang("es-419")).toBe("es");
    expect(splashLang("pt-BR")).toBe("pt");
    expect(splashLang("de")).toBe("en");
    expect(splashLang("")).toBe("en");
    expect(splashLang(null)).toBe("en");
  });

  test("status strings follow the locale", () => {
    expect(splashStatus("en-US", "starting")).toBe("Starting");
    expect(splashStatus("fr", "waiting")).toBe("Attente du serveur");
    expect(splashStatus("es", "opening")).toBe("Abriendo Inicio");
    expect(splashStatus("pt-BR", "restarting")).toBe("Servidor parado — reiniciando");
    expect(splashStatus("ja", "starting")).toBe("Starting");
  });
});
