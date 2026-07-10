import { describe, it, expect } from "vitest";
import { buildStaffMessage } from "../../supabase/functions/support-notify-staff/message.ts";

describe("buildStaffMessage", () => {
  const base = { id: "t1", title: "Não consigo mover card no funil", tipo: "bug", impacto: "parado" };

  it("traz organização, impacto legível, tipo, título e o deep-link", () => {
    const msg = buildStaffMessage(base, "Acme Distribuidora");
    expect(msg).toContain("Acme Distribuidora");
    expect(msg).toContain("🔴 Parado");
    expect(msg).toContain("Bug");
    expect(msg).toContain("Não consigo mover card no funil");
    expect(msg).toContain("https://torquecrm.com.br/master/support-tickets");
  });

  it("mapeia cada tipo e impacto para rótulo em português", () => {
    expect(buildStaffMessage({ ...base, tipo: "duvida" }, "X")).toContain("Dúvida");
    expect(buildStaffMessage({ ...base, tipo: "solicitacao" }, "X")).toContain("Solicitação");
    expect(buildStaffMessage({ ...base, impacto: "contorno" }, "X")).toContain("🟡 Com contorno");
    expect(buildStaffMessage({ ...base, impacto: "incomodo" }, "X")).toContain("⚪ Incômodo");
  });

  it("corta título gigante para não empurrar o deep-link pra fora da prévia", () => {
    const longo = "a".repeat(300);
    const msg = buildStaffMessage({ ...base, title: longo }, "X");
    expect(msg).toContain("…");
    expect(msg).toContain("https://torquecrm.com.br/master/support-tickets");
    // o título cortado nunca excede 140 chars
    const linhaTitulo = msg.split("\n").find((l) => l.startsWith("a"))!;
    expect(linhaTitulo.length).toBeLessThanOrEqual(140);
  });

  it("cai no valor cru quando tipo/impacto vêm fora do dicionário", () => {
    const msg = buildStaffMessage({ ...base, tipo: "desconhecido", impacto: "estranho" }, "X");
    expect(msg).toContain("desconhecido");
    expect(msg).toContain("estranho");
  });

  it("não interpola o título em nada que o WhatsApp interprete como comando", () => {
    // título com caracteres de marcação não deve quebrar a montagem
    const msg = buildStaffMessage({ ...base, title: "*bug* _grave_ ```x```" }, "Org");
    expect(msg).toContain("*bug* _grave_ ```x```");
    expect(msg).toContain("Org");
  });
});
