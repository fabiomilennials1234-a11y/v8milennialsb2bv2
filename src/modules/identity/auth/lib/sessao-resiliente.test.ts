import { describe, expect, it, vi } from "vitest";
import {
  ESPERA_APOS_FALHA_MS,
  criarRenovador,
  defasagemDoRelogio,
  descreverDefasagem,
  ehTokenVencido,
  msAteRenovar,
  payloadDoJwt,
} from "./sessao-resiliente";

/** JWT só com payload (assinatura irrelevante: só lemos iat/exp). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.assinatura`;
}

describe("ehTokenVencido", () => {
  it("reconhece o token de acesso vencido do PostgREST e do gateway", () => {
    expect(ehTokenVencido({ code: "PGRST301", message: "JWT expired" })).toBe(true);
    expect(ehTokenVencido({ code: "PGRST303", message: "JWT expired" })).toBe(true);
    expect(ehTokenVencido({ status: 401, message: "JWT expired" })).toBe(true);
    expect(ehTokenVencido(new Error("jwt expired"))).toBe(true);
  });

  it("não confunde com sessão perdida, permissão ou rede — renovar não resolve esses", () => {
    expect(ehTokenVencido({ code: "session_not_found", message: "Session not found" })).toBe(false);
    expect(ehTokenVencido({ code: "refresh_token_already_used", message: "Invalid Refresh Token" })).toBe(false);
    expect(ehTokenVencido({ code: "42501", message: "permission denied" })).toBe(false);
    expect(ehTokenVencido(new TypeError("Failed to fetch"))).toBe(false);
    expect(ehTokenVencido(null)).toBe(false);
  });
});

describe("criarRenovador", () => {
  it("várias consultas falhando juntas: UMA renovação", async () => {
    const renovar = vi.fn(async () => true);
    const r = criarRenovador(renovar);
    const [a, b, c] = await Promise.all([r(), r(), r()]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(renovar).toHaveBeenCalledTimes(1);
  });

  it("depois de falhar, espera antes de tentar de novo — nunca vira laço", async () => {
    let agora = 1_000_000;
    const renovar = vi.fn(async () => false);
    const r = criarRenovador(renovar, () => agora);
    expect(await r()).toBe(false);
    agora += ESPERA_APOS_FALHA_MS - 1;
    expect(await r()).toBe(false);
    expect(renovar).toHaveBeenCalledTimes(1);
    agora += 2;
    await r();
    expect(renovar).toHaveBeenCalledTimes(2);
  });

  it("erro lançado pelo Auth conta como falha, não estoura", async () => {
    const r = criarRenovador(async () => {
      throw new Error("offline");
    });
    expect(await r()).toBe(false);
  });

  it("renovação que deu certo não segura a próxima", async () => {
    const renovar = vi.fn(async () => true);
    const r = criarRenovador(renovar);
    await r();
    await r();
    expect(renovar).toHaveBeenCalledTimes(2);
  });
});

describe("relógio do computador", () => {
  const IAT = 1_762_862_400; // hora do servidor ao emitir o token

  it("relógio 12 min atrasado: defasagem negativa", () => {
    const agora = (IAT - 12 * 60) * 1000;
    expect(defasagemDoRelogio(jwt({ iat: IAT, exp: IAT + 3600 }), agora)).toBe(-12 * 60 * 1000);
    expect(descreverDefasagem(-12 * 60 * 1000)).toBe("12 min atrasado");
  });

  it("relógio adiantado: defasagem positiva", () => {
    expect(descreverDefasagem(3 * 60 * 1000)).toBe("3 min adiantado");
  });

  it("token sem iat ou ilegível: sem medida (não inventa defasagem)", () => {
    expect(defasagemDoRelogio(jwt({ exp: IAT }))).toBeNull();
    expect(defasagemDoRelogio("lixo")).toBeNull();
    expect(payloadDoJwt(undefined)).toBeNull();
  });

  it("agenda a renovação pela hora do SERVIDOR: relógio atrasado não deixa o token vencer", () => {
    const defasagem = -12 * 60 * 1000;
    const agoraLocal = IAT * 1000 + defasagem; // logo depois do login, no relógio local
    // Vence às IAT+3600 (servidor); renova 60 s antes, em hora do servidor.
    expect(msAteRenovar(IAT + 3600, defasagem, agoraLocal)).toBe(3600_000 - 60_000);
  });

  it("já passou da hora: renova agora", () => {
    expect(msAteRenovar(IAT, 0, (IAT + 10) * 1000)).toBe(0);
  });
});
