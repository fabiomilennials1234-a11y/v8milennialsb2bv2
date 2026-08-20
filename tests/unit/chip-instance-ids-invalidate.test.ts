/**
 * O apagão que este teste tranca: quando a resolução do chip degrada pra
 * `[instância viva]` e o chip acabou de ser recriado, a instância viva não tem
 * NADA do histórico. Medido na Chique (2026-08-19): 65 de 65 mensagens do
 * contato viviam em três lápides, 0 na instância viva.
 *
 * O "Tentar de novo" da tela só vale se descartar a entrada do cache — senão
 * `refetch` recebe o mesmo conjunto degradado de volta.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { resolveChipInstanceIds, invalidateChipInstanceIds, clearChipInstanceIdsCache } =
  await import("@/modules/communication/lib/chipInstanceIds");

const ORG = "org-1";
const LIVE = "instancia-viva";
const LAPIDE = "instancia-morta";

describe("invalidateChipInstanceIds", () => {
  beforeEach(() => {
    clearChipInstanceIdsCache();
    rpc.mockReset();
  });

  it("sem invalidar, o resultado degradado fica grudado no cache", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "42883" } });
    expect(await resolveChipInstanceIds(ORG, LIVE)).toEqual([LIVE]);

    // A RPC já voltaria boa — mas ninguém pergunta de novo.
    rpc.mockResolvedValue({ data: [LAPIDE], error: null });
    expect(await resolveChipInstanceIds(ORG, LIVE)).toEqual([LIVE]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("invalidando, a próxima leitura re-resolve e recupera as lápides", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "42883" } });
    expect(await resolveChipInstanceIds(ORG, LIVE)).toEqual([LIVE]);

    invalidateChipInstanceIds(ORG, LIVE);
    rpc.mockResolvedValue({ data: [LAPIDE], error: null });

    expect(await resolveChipInstanceIds(ORG, LIVE)).toEqual([LIVE, LAPIDE]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("não derruba o chip de outra instância nem de outra org", async () => {
    rpc.mockResolvedValue({ data: [LAPIDE], error: null });
    await resolveChipInstanceIds(ORG, LIVE);
    await resolveChipInstanceIds("org-2", LIVE);
    expect(rpc).toHaveBeenCalledTimes(2);

    invalidateChipInstanceIds(ORG, LIVE);
    await resolveChipInstanceIds("org-2", LIVE);
    expect(rpc).toHaveBeenCalledTimes(2);

    await resolveChipInstanceIds(ORG, LIVE);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("argumento nulo é no-op, não estoura", () => {
    expect(() => invalidateChipInstanceIds(null, LIVE)).not.toThrow();
    expect(() => invalidateChipInstanceIds(ORG, undefined)).not.toThrow();
  });
});
