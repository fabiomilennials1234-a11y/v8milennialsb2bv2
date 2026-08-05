// @vitest-environment node
/**
 * getWhatsAppInstance — a fronteira entre os handlers de envio e a Instance
 * Routing Policy (ADR-0025).
 *
 * Este arquivo cobria o antigo "org-default": as instâncias vivas da
 * organização ordenadas por `last_connection_at`, e a primeira levava. Essa
 * regra saiu — ela escolhia sem relação nenhuma com o lead, e trocava de
 * escolha sozinha quando outro número reconectava. O que sobrou dela e segue
 * valendo é o filtro de sessão viva, coberto aqui.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "19/06/2026", hora: "10:00" }),
}));
vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

import { getWhatsAppInstance } from "../../../supabase/functions/_shared/action-handlers/whatsapp-helpers";

const LIVE = {
  id: "inst-live",
  instance_name: "Comercial Vivo",
  organization_id: "org-1",
  status: "connected",
  provider: "uazapi",
  session_dead_since: null,
  last_connection_at: "2026-06-19T12:00:00Z",
};

// status congelado em "connected" — WhatsApp deslogado de outro aparelho; o
// watchdog carimbou session_dead_since. É o formato do caso Bertin 1f7bb711.
const DEAD = {
  id: "inst-dead",
  instance_name: "Comercial Morto",
  organization_id: "org-1",
  status: "connected",
  provider: "uazapi",
  session_dead_since: "2026-06-17T13:40:02Z",
  last_connection_at: "2026-06-15T13:21:30Z",
};

describe("getWhatsAppInstance — sessão viva", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignora a instância com sessão morta e usa a viva", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [DEAD, LIVE]);

    const res = await getWhatsAppInstance(sb, "org-1", {}, null);
    expect(res.ok).toBe(true);
    expect(res.ok && res.instanceId).toBe("inst-live");
  });

  it("falha, sem retentativa, quando a única candidata está com sessão morta", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [DEAD]);

    const res = await getWhatsAppInstance(sb, "org-1", {}, null);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.failure.retryable).toBe(false);
  });

  // A regra antiga desempatava por `last_connection_at`. Hoje duas vivas sem
  // política que resolva é ambiguidade — e ambiguidade falha em vez de sortear.
  it("com duas vivas e nada declarado, falha em vez de escolher a mais recente", async () => {
    const outraViva = { ...LIVE, id: "inst-outra", instance_name: "Outro", last_connection_at: "2026-06-10T08:00:00Z" };
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [outraViva, LIVE]);

    const res = await getWhatsAppInstance(sb, "org-1", {}, null);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.failure.retryable).toBe(false);
  });

  it("com duas vivas, o recuo declarado no nó resolve", async () => {
    const outraViva = { ...LIVE, id: "inst-outra", instance_name: "Outro" };
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_instances", [outraViva, LIVE]);

    const res = await getWhatsAppInstance(sb, "org-1", { fallbackInstanceId: "inst-outra" }, null);
    expect(res.ok).toBe(true);
    expect(res.ok && res.instanceId).toBe("inst-outra");
  });
});
