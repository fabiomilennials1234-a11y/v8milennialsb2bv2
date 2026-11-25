// @vitest-environment node
/**
 * Candidata da foto do contato no envelope `messages` da Uazapi.
 *
 * O payload é montado a partir das CHAVES reais capturadas do SSE do TorqueSDR
 * (tests/fixtures/uazapi/torquesdr-sse-shapes-2026-09-11.json): a fixture
 * guarda só tipos, então cada chave `chat.*` e `message.*` do shape real entra
 * com um valor do tipo declarado, e o teste sobrescreve as que importam.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { uazapiChatAvatarCandidate } from "../../supabase/functions/_shared/uazapi-event";
import {
  AvatarCandidateMemo,
  avatarCandidateKey,
  isAllowedAvatarUrl,
  registerAvatarCandidate,
} from "../../supabase/functions/_shared/contact-avatar";

type Shape = Record<string, unknown>;
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/uazapi/torquesdr-sse-shapes-2026-09-11.json", import.meta.url), "utf8"),
) as Array<{ event: string; shape: Shape }>;
const messagesShape = fixture.find((f) => f.event === "messages")!.shape;

/** Valor de exemplo para cada tipo da fixture. */
function materialize(shape: unknown): unknown {
  if (shape === "string") return "";
  if (shape === "number") return 0;
  if (shape === "boolean") return false;
  if (shape && typeof shape === "object") {
    const s = shape as Shape;
    if (s.type === "array") return [];
    return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, materialize(v)]));
  }
  return null;
}

const PREVIEW = "https://pps.whatsapp.net/v/t61.24694-24/1_n.jpg?stp=dst-jpg_s96x96&ccb=11-4&oh=01_A&oe=69300000&_nc_cat=1";
const FULL = "https://pps.whatsapp.net/v/t61.24694-24/1_n.jpg?ccb=11-4&oh=01_B&oe=69300000";

function payload(chat: Shape = {}, message: Shape = {}) {
  const base = materialize(messagesShape) as Shape;
  return {
    ...base,
    chat: { ...(base.chat as Shape), wa_chatid: "5511999990001@s.whatsapp.net", imagePreview: PREVIEW, image: FULL, ...chat },
    message: { ...(base.message as Shape), fromMe: false, ...message },
  };
}

describe("uazapiChatAvatarCandidate", () => {
  it("o shape real tem as chaves que a função lê", () => {
    const chat = messagesShape.chat as Shape;
    for (const k of ["wa_chatid", "wa_isGroup", "image", "imagePreview"]) expect(chat).toHaveProperty(k);
    expect(messagesShape.message as Shape).toHaveProperty("fromMe");
  });

  it("1:1 recebida → telefone do JID + imagePreview", () => {
    expect(uazapiChatAvatarCandidate(payload())).toEqual({ phone: "5511999990001", url: PREVIEW });
  });

  it("sem imagePreview usa image", () => {
    expect(uazapiChatAvatarCandidate(payload({ imagePreview: "" }))).toEqual({ phone: "5511999990001", url: FULL });
  });

  it("caixa Uazapi explícita passa; provedor ausente é Uazapi", () => {
    expect(uazapiChatAvatarCandidate(payload(), "uazapi")).not.toBeNull();
    expect(uazapiChatAvatarCandidate(payload(), null)).not.toBeNull();
  });

  it.each([
    ["grupo por flag", payload({ wa_isGroup: true })],
    ["grupo por JID", payload({ wa_chatid: "120363000000000000@g.us" })],
    ["@lid", payload({ wa_chatid: "210028246085780@lid" })],
    ["JID vazio", payload({ wa_chatid: "" })],
    ["fromMe", payload({}, { fromMe: true })],
    ["URL vazia", payload({ imagePreview: "", image: "" })],
    ["host de fora", payload({ imagePreview: "https://evil.example/a.jpg", image: "" })],
    ["host com sufixo enganoso", payload({ imagePreview: "https://pps.whatsapp.net.evil.example/a.jpg", image: "" })],
    ["http", payload({ imagePreview: "http://pps.whatsapp.net/a.jpg", image: "" })],
    ["userinfo", payload({ imagePreview: "https://x@pps.whatsapp.net/a.jpg", image: "" })],
    ["porta", payload({ imagePreview: "https://pps.whatsapp.net:444/a.jpg", image: "" })],
    ["longa demais", payload({ imagePreview: `https://pps.whatsapp.net/${"a".repeat(2100)}`, image: "" })],
    ["chat ausente", { message: { fromMe: false } }],
  ])("%s → null", (_name, p) => {
    expect(uazapiChatAvatarCandidate(p as Shape)).toBeNull();
  });

  it("caixa de outro provedor → null", () => {
    expect(uazapiChatAvatarCandidate(payload(), "evolution")).toBeNull();
    expect(uazapiChatAvatarCandidate(payload(), "notificame")).toBeNull();
  });

  it("URL ruim em imagePreview NÃO cai para image (a preview é a escolhida)", () => {
    expect(uazapiChatAvatarCandidate(payload({ imagePreview: "https://evil.example/a.jpg" }))).toBeNull();
  });
});

describe("isAllowedAvatarUrl / avatarCandidateKey", () => {
  it("aceita subdomínio do CDN e recusa o domínio nu", () => {
    expect(isAllowedAvatarUrl("https://mmg.whatsapp.net/a.jpg")).toBe(true);
    expect(isAllowedAvatarUrl("https://whatsapp.net/a.jpg")).toBe(false);
    expect(isAllowedAvatarUrl("https://pps.whatsapp.net\\@evil.example/a.jpg")).toBe(false);
    expect(isAllowedAvatarUrl(42)).toBe(false);
  });

  it("a chave ignora query e fragmento", () => {
    expect(avatarCandidateKey(PREVIEW)).toBe("https://pps.whatsapp.net/v/t61.24694-24/1_n.jpg");
    expect(avatarCandidateKey(FULL)).toBe(avatarCandidateKey(PREVIEW));
  });
});

describe("registerAvatarCandidate (memo do isolate)", () => {
  const candidate = { phone: "5511999990001", url: PREVIEW };

  it("chama a RPC uma vez por foto e pula a repetida", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const memo = new AvatarCandidateMemo();
    expect(await registerAvatarCandidate({ rpc }, "org", "box", candidate, memo)).toBe("registered");
    expect(await registerAvatarCandidate({ rpc }, "org", "box", { ...candidate, url: FULL.replace("oh=01_B", "oh=01_C") }, memo)).toBe("skipped");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("registrar_avatar_candidato", {
      p_organization_id: "org", p_instance_id: "box", p_phone: "5511999990001", p_url: PREVIEW,
    });
  });

  it("foto trocada chama de novo; erro não memoriza e sobe", async () => {
    const memo = new AvatarCandidateMemo();
    const rpc = vi.fn().mockResolvedValueOnce({ error: { message: "boom" } }).mockResolvedValue({ error: null });
    await expect(registerAvatarCandidate({ rpc }, "org", "box", candidate, memo)).rejects.toThrow(/boom/);
    expect(await registerAvatarCandidate({ rpc }, "org", "box", candidate, memo)).toBe("registered");
    expect(await registerAvatarCandidate({ rpc }, "org", "box", { ...candidate, url: "https://pps.whatsapp.net/outra.jpg" }, memo)).toBe("registered");
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("memo expira no TTL e respeita o teto (LRU)", () => {
    const memo = new AvatarCandidateMemo(2, 1000);
    memo.remember("a", "k", 0);
    expect(memo.seen("a", "k", 999)).toBe(true);
    expect(memo.seen("a", "k", 1000)).toBe(false);
    memo.remember("a", "k", 0);
    memo.remember("b", "k", 0);
    memo.seen("a", "k", 1); // toca "a": "b" vira o mais antigo
    memo.remember("c", "k", 1);
    expect(memo.size).toBe(2);
    expect(memo.seen("b", "k", 2)).toBe(false);
    expect(memo.seen("a", "k", 2)).toBe(true);
  });
});
