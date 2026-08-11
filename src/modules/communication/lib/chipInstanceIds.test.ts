/**
 * O contrato inteiro deste módulo é "não pode piorar nada".
 *
 * Ele roda em produção ANTES da migration que cria
 * `whatsapp_chip_instance_ids` — o front sobe sozinho no merge pra `main`, a
 * migration é passo manual. Então os casos que importam não são o caminho
 * feliz: são a RPC inexistente, a resposta torta e o cache que não pode
 * congelar a degradação até o próximo F5.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpcMock = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResult));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
}));

import {
  resolveChipInstanceIds,
  resolveChipInstanceIdMap,
  clearChipInstanceIdsCache,
  CHIP_IDS_TTL_MS,
  CHIP_IDS_FALLBACK_TTL_MS,
} from "./chipInstanceIds";

beforeEach(() => {
  rpcResult.data = null;
  rpcResult.error = null;
  rpcMock.mockClear();
  clearChipInstanceIdsCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveChipInstanceIds — conjunto do chip", () => {
  it("devolve os ids históricos junto com a instância viva", async () => {
    rpcResult.data = ["inst-1", "morta-a", "morta-b"];

    await expect(resolveChipInstanceIds("org-1", "inst-1")).resolves.toEqual([
      "inst-1",
      "morta-a",
      "morta-b",
    ]);
    expect(rpcMock).toHaveBeenCalledWith("whatsapp_chip_instance_ids", {
      p_org: "org-1",
      p_instance: "inst-1",
    });
  });

  it("a instância viva encabeça o conjunto mesmo se a RPC não a listar", async () => {
    rpcResult.data = ["morta-a"];
    await expect(resolveChipInstanceIds("org-1", "inst-1")).resolves.toEqual([
      "inst-1",
      "morta-a",
    ]);
  });

  it("resposta torta (nula, duplicada, não-string) não contamina o filtro", async () => {
    rpcResult.data = ["morta-a", "morta-a", null, 42, "", "inst-1"];
    await expect(resolveChipInstanceIds("org-1", "inst-1")).resolves.toEqual([
      "inst-1",
      "morta-a",
    ]);
  });

  it("conjunto vazio ou nulo NUNCA vira filtro vazio — cai na instância viva", async () => {
    // `.in("instance_id", [])` devolve thread VAZIA pra todo mundo: seria trocar
    // "sumiu o histórico da instância excluída" por "sumiu a conversa inteira".
    rpcResult.data = [];
    await expect(resolveChipInstanceIds("org-1", "inst-1")).resolves.toEqual(["inst-1"]);

    rpcResult.data = null;
    await expect(resolveChipInstanceIds("org-1", "inst-2")).resolves.toEqual(["inst-2"]);
  });

  it("sem instância não há conversa; sem org não há consulta", async () => {
    await expect(resolveChipInstanceIds("org-1", null)).resolves.toEqual([]);
    await expect(resolveChipInstanceIds(null, "inst-1")).resolves.toEqual(["inst-1"]);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("resolveChipInstanceIds — degradação deploy-order-safe", () => {
  it("RPC inexistente vira o comportamento de hoje, sem rejeitar", async () => {
    rpcResult.error = { message: "function whatsapp_chip_instance_ids does not exist" };
    await expect(resolveChipInstanceIds("org-1", "inst-1")).resolves.toEqual(["inst-1"]);
  });

  it("degradação deixa rastro no console — silêncio foi o que escondeu o incidente", async () => {
    rpcResult.error = { message: "42883" };
    await resolveChipInstanceIds("org-1", "inst-1");
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("resolveChipInstanceIds — cache", () => {
  it("uma resolução por (org, instância): a thread refetcha, o mapa não muda", async () => {
    rpcResult.data = ["inst-1", "morta-a"];

    await resolveChipInstanceIds("org-1", "inst-1");
    await resolveChipInstanceIds("org-1", "inst-1");
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Org diferente é outra identidade — nunca reaproveita.
    await resolveChipInstanceIds("org-2", "inst-1");
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("chamadas concorrentes compartilham a mesma requisição em voo", async () => {
    rpcResult.data = ["inst-1"];
    await Promise.all([
      resolveChipInstanceIds("org-1", "inst-1"),
      resolveChipInstanceIds("org-1", "inst-1"),
      resolveChipInstanceIds("org-1", "inst-1"),
    ]);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("o resultado degradado expira antes do bom — a aba se cura sem F5", async () => {
    expect(CHIP_IDS_FALLBACK_TTL_MS).toBeLessThan(CHIP_IDS_TTL_MS);

    vi.useFakeTimers();
    rpcResult.error = { message: "does not exist" };
    await resolveChipInstanceIds("org-1", "inst-1");
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Migration entrou em prod nesse intervalo.
    vi.advanceTimersByTime(CHIP_IDS_FALLBACK_TTL_MS + 1);
    rpcResult.error = null;
    rpcResult.data = ["inst-1", "morta-a"];

    await expect(resolveChipInstanceIds("org-1", "inst-1")).resolves.toEqual([
      "inst-1",
      "morta-a",
    ]);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});

describe("resolveChipInstanceIdMap — caminho de volta pra instância viva", () => {
  it("mapeia id histórico → instância viva e cada viva pra si mesma", async () => {
    rpcMock.mockImplementation((_fn: unknown, args: unknown) => {
      const { p_instance } = args as { p_instance: string };
      return Promise.resolve({
        data: p_instance === "viva-a" ? ["viva-a", "morta-1"] : ["viva-b"],
        error: null,
      });
    });

    const map = await resolveChipInstanceIdMap("org-1", ["viva-a", "viva-b"]);

    expect(map.get("morta-1")).toBe("viva-a");
    expect(map.get("viva-a")).toBe("viva-a");
    expect(map.get("viva-b")).toBe("viva-b");
    expect(map.has("de-outra-org")).toBe(false);
  });

  it("instância viva nunca é sequestrada pelo histórico de outra", async () => {
    // Mapa torto: o chip A reivindica um id que está VIVO como B. Se isso
    // vencesse, o deep-link abriria a instância errada.
    rpcMock.mockImplementation((_fn: unknown, args: unknown) => {
      const { p_instance } = args as { p_instance: string };
      return Promise.resolve({
        data: p_instance === "viva-a" ? ["viva-a", "viva-b"] : ["viva-b"],
        error: null,
      });
    });

    const map = await resolveChipInstanceIdMap("org-1", ["viva-a", "viva-b"]);
    expect(map.get("viva-b")).toBe("viva-b");
  });
});
