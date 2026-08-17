// @vitest-environment node
/**
 * Espelhamento do avatar do interlocutor.
 *
 * ─── POR QUE ESPELHAR ───────────────────────────────────────────────────────
 *
 * A URL que a Meta manda é ASSINADA E TEMPORÁRIA. Medido no primeiro payload
 * real (2026-08-17): `oe=6A890279`, ou seja, expira em ~104 horas. Guardar a URL
 * não é guardar a foto — em quatro dias todo avatar do inbox vira ícone
 * quebrado, e o sintoma não aponta para lugar nenhum.
 *
 * ─── E POR QUE ISTO NÃO PODE DERRUBAR O INBOUND ─────────────────────────────
 *
 * Avatar é decoração; mensagem é o produto. Toda decisão aqui é enviesada para
 * "na dúvida, deixa passar sem foto": timeout curto, teto de tamanho, tipo
 * conferido, e QUALQUER falha devolve `null` para o chamador seguir com a URL
 * original. Um webhook que falha por causa de uma imagem perde a mensagem.
 */
import { describe, it, expect } from "vitest";

import {
  avatarStoragePath,
  isAcceptableAvatar,
  shouldRefreshAvatar,
  AVATAR_MAX_BYTES,
} from "../../supabase/functions/_shared/notificame-avatar.ts";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";

describe("avatarStoragePath — determinístico por contato", () => {
  it("mesma org e mesmo contato ⇒ mesmo caminho", () => {
    const a = avatarStoragePath(ORG, "instagram", "1527557648673564");
    const b = avatarStoragePath(ORG, "instagram", "1527557648673564");

    expect(a).toBe(b);
    // Determinístico é o que permite reusar o objeto em vez de acumular um
    // arquivo por mensagem recebida.
    expect(a).toContain(ORG);
    expect(a).toContain("1527557648673564");
  });

  it("separa por organização — o mesmo IGSID em duas orgs não colide", () => {
    const outraOrg = "9d0367c6-2ae8-40cf-9862-a225a5b19026";

    expect(avatarStoragePath(ORG, "instagram", "999"))
      .not.toBe(avatarStoragePath(outraOrg, "instagram", "999"));
  });

  it("neutraliza caractere de caminho no id do fornecedor", () => {
    // Um id com barra criaria pasta no bucket e, na pior hipótese, escreveria
    // fora do prefixo da org.
    const path = avatarStoragePath(ORG, "instagram", "../../outra-org/roubado");

    expect(path).not.toContain("..");
    expect(path.startsWith(`notificame/avatars/${ORG}/`)).toBe(true);
  });
});

describe("isAcceptableAvatar — o que vale a pena baixar", () => {
  it("aceita imagem dentro do teto", () => {
    expect(isAcceptableAvatar("image/jpeg", 5567)).toBe(true);
  });

  it("recusa o que não é imagem", () => {
    // Um HTML de erro do CDN vem com 200 e corpo de página.
    expect(isAcceptableAvatar("text/html", 1200)).toBe(false);
    expect(isAcceptableAvatar(null, 1200)).toBe(false);
  });

  it("recusa acima do teto", () => {
    expect(isAcceptableAvatar("image/jpeg", AVATAR_MAX_BYTES + 1)).toBe(false);
  });

  it("tamanho desconhecido é aceito — o download aplica o teto na leitura", () => {
    expect(isAcceptableAvatar("image/jpeg", null)).toBe(true);
  });
});

describe("shouldRefreshAvatar — quando vale re-baixar", () => {
  const agora = new Date("2026-08-17T18:00:00Z");

  it("sem cópia nossa, espelha", () => {
    expect(shouldRefreshAvatar(null, agora)).toBe(true);
  });

  it("cópia recente não é re-baixada", () => {
    // Avatar muda raramente. Re-baixar a cada mensagem gastaria uma requisição
    // ao CDN e um upload por mensagem recebida, para trocar bytes idênticos.
    expect(shouldRefreshAvatar(new Date("2026-08-16T18:00:00Z"), agora)).toBe(false);
  });

  it("cópia velha é renovada — a foto do perfil pode ter mudado", () => {
    expect(shouldRefreshAvatar(new Date("2026-07-01T00:00:00Z"), agora)).toBe(true);
  });

  it("data ilegível conta como ausência de cópia", () => {
    expect(shouldRefreshAvatar(new Date("nao-e-data"), agora)).toBe(true);
  });
});
