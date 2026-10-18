import { describe, expect, it } from "vitest";
import {
  intervaloDaRedeDeSeguranca,
  REDE_DE_SEGURANCA_MS,
  SONDA_COM_CANAL_SAUDAVEL_MS,
} from "./rede-de-seguranca-de-avisos";

describe("intervaloDaRedeDeSeguranca", () => {
  it("canal de pé: só a sonda lenta de 5 min", () => {
    expect(intervaloDaRedeDeSeguranca(true, "joined")).toBe(SONDA_COM_CANAL_SAUDAVEL_MS);
    expect(SONDA_COM_CANAL_SAUDAVEL_MS).toBe(300_000);
  });

  it.each(["idle", "joining", "errored", "polling"] as const)("canal %s: rede de 30 s", (estado) => {
    expect(intervaloDaRedeDeSeguranca(true, estado)).toBe(REDE_DE_SEGURANCA_MS);
    expect(REDE_DE_SEGURANCA_MS).toBe(30_000);
  });

  it("quem só lê (sino) nunca consulta sozinho", () => {
    expect(intervaloDaRedeDeSeguranca(false, "errored")).toBe(false);
    expect(intervaloDaRedeDeSeguranca(false, "joined")).toBe(false);
  });
});
