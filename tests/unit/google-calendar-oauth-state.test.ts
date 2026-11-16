/**
 * google-calendar-oauth-state — `state` OAuth assinado (vetor cross-tenant).
 *
 * O `state` era base64 puro de `{userId, orgId, ts}` e o callback público
 * confiava nele para gravar tokens com service_role. Estes testes fixam que
 * forjado, adulterado, assinado com outra chave, expirado ou com validade
 * esticada é recusado, e que o genuíno faz o round-trip.
 */
import { describe, expect, it } from "vitest";
import {
  signGoogleCalendarState,
  STATE_TTL_MS,
  verifyGoogleCalendarState,
} from "../../supabase/functions/_shared/google-calendar-oauth-state.ts";

const SECRET = "google-client-secret-test";
const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const VICTIM_USER = "33333333-3333-4333-8333-333333333333";
const VICTIM_ORG = "44444444-4444-4444-8444-444444444444";
const NONCE = "55555555-5555-4555-8555-555555555555";
const NOW = 1_800_000_000_000;

const b64url = (s: string) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function genuine(now = NOW) {
  return signGoogleCalendarState({ userId: USER, orgId: ORG, nonce: NONCE }, SECRET, { now });
}

describe("google-calendar-oauth-state", () => {
  it("faz round-trip de um state genuíno dentro da validade", async () => {
    const { state, expiresAt } = await genuine();
    expect(expiresAt).toBe(NOW + STATE_TTL_MS);
    expect(STATE_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000);
    const out = await verifyGoogleCalendarState(state, SECRET, { now: NOW + STATE_TTL_MS - 1 });
    expect(out).toEqual({ v: 1, userId: USER, orgId: ORG, nonce: NONCE, iat: NOW, exp: NOW + STATE_TTL_MS });
  });

  it("recusa o formato antigo forjado (base64 puro, sem assinatura)", async () => {
    const legacy = btoa(JSON.stringify({ userId: VICTIM_USER, orgId: VICTIM_ORG, ts: NOW }));
    expect(await verifyGoogleCalendarState(legacy, SECRET, { now: NOW })).toBeNull();
  });

  it("recusa payload forjado com assinatura inventada", async () => {
    const payload = b64url(JSON.stringify({ v: 1, userId: VICTIM_USER, orgId: VICTIM_ORG, nonce: NONCE, iat: NOW, exp: NOW + 60_000 }));
    expect(await verifyGoogleCalendarState(`${payload}.${"A".repeat(43)}`, SECRET, { now: NOW })).toBeNull();
  });

  it("recusa payload adulterado (troca userId/orgId e mantém a assinatura original)", async () => {
    const { state } = await genuine();
    const [, mac] = state.split(".");
    for (const delta of [{ userId: VICTIM_USER }, { orgId: VICTIM_ORG }, { exp: NOW + 365 * 86_400_000 }]) {
      const forged = b64url(JSON.stringify({ v: 1, userId: USER, orgId: ORG, nonce: NONCE, iat: NOW, exp: NOW + STATE_TTL_MS, ...delta }));
      expect(await verifyGoogleCalendarState(`${forged}.${mac}`, SECRET, { now: NOW })).toBeNull();
    }
  });

  it("recusa assinatura adulterada em um único caractere", async () => {
    const { state } = await genuine();
    const flipped = state.slice(0, -1) + (state.endsWith("A") ? "B" : "A");
    expect(await verifyGoogleCalendarState(flipped, SECRET, { now: NOW })).toBeNull();
  });

  it("recusa state assinado com outra chave e verificação sem chave", async () => {
    const { state } = await signGoogleCalendarState({ userId: USER, orgId: ORG, nonce: NONCE }, "outra-chave", { now: NOW });
    expect(await verifyGoogleCalendarState(state, SECRET, { now: NOW })).toBeNull();
    const ok = await genuine();
    expect(await verifyGoogleCalendarState(ok.state, "", { now: NOW })).toBeNull();
  });

  it("recusa state expirado (no limite exato e depois)", async () => {
    const { state } = await genuine();
    expect(await verifyGoogleCalendarState(state, SECRET, { now: NOW + STATE_TTL_MS })).toBeNull();
    expect(await verifyGoogleCalendarState(state, SECRET, { now: NOW + 60 * 60 * 1000 })).toBeNull();
  });

  it("recusa malformados sem lançar", async () => {
    for (const bad of ["", "semponto", "a.b.c", ".", "a.", ".b", "!!!.???", "x".repeat(5000)]) {
      expect(await verifyGoogleCalendarState(bad, SECRET, { now: NOW })).toBeNull();
    }
    expect(await verifyGoogleCalendarState(undefined as unknown as string, SECRET)).toBeNull();
  });

  it("não emite state sem segredo ou com ids fora do formato UUID", async () => {
    await expect(signGoogleCalendarState({ userId: USER, orgId: ORG, nonce: NONCE }, "")).rejects.toThrow();
    await expect(signGoogleCalendarState({ userId: USER, orgId: "", nonce: NONCE }, SECRET)).rejects.toThrow();
    await expect(signGoogleCalendarState({ userId: "u1", orgId: ORG, nonce: NONCE }, SECRET)).rejects.toThrow();
  });
});
