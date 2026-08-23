/**
 * Fatia "lead vinculado a identidade de Instagram" — O LEAD NASCE SEM TELEFONE.
 *
 * `leads` tem como identidade APENAS email/phone/normalized_phone/phone_digits.
 * Instagram não entrega nenhum dos quatro: o que chega é o IGSID, id estável da
 * PESSOA no app. Logo, o lead criado a partir de uma conversa de Instagram nasce
 * estruturalmente sem telefone — e isso é legal no banco (as únicas colunas NOT
 * NULL de `leads` são id, name, created_at, updated_at, excluded_from_metrics).
 *
 * Este arquivo tranca as duas metades desse fato:
 *
 *   A) `phone` é NULL, JAMAIS `''`. E aqui uma premissa do plano é REFUTADA com
 *      o código de produção na mão — a refutação melhora o argumento em vez de
 *      enfraquecê-lo, e é por isso que ela está escrita como caso de teste.
 *
 *   B) O que um lead sem telefone atravessa sem quebrar (as portas fecham
 *      fail-closed, antes de qualquer I/O) e o que ele expõe de defeito JÁ
 *      EXISTENTE no produto (a ação de agendar mensagem, que não é gateada).
 *
 * Tudo aqui roda contra as funções REAIS de produção — nenhuma reimplementação
 * de normalizador dentro do teste, que seria testar o dublê.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const envStore: Record<string, string> = {
  UAZAPI_BASE_URL: "https://uazapi.example.com",
  UAZAPI_ADMIN_TOKEN: "admin-secret",
};
if (typeof globalThis.Deno === "undefined") {
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (key: string) => envStore[key] ?? undefined },
    serve: () => {},
  };
}

import { normalizePhone } from "@/lib/normalizePhone";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import {
  normalizeBrazilianPhone,
  resolveDispatchContext,
  DispatchResolutionError,
} from "../../supabase/functions/_shared/whatsapp-dispatch.ts";
import { normalizePhoneForSearch } from "../../supabase/functions/_shared/lead-service.ts";

const REPO = path.resolve(__dirname, "../..");
const BASELINE = readFileSync(
  path.join(REPO, "supabase/migrations/20260101000000_baseline_prod_schema.sql"),
  "utf8",
);

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";

// ─── A. `phone` é NULL, e o motivo real não é o que o plano supôs ────────────

describe("A. o campo phone do lead de Instagram", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string vazia", ""],
    ["só espaço", "   "],
  ])("os TRÊS normalizadores TS devolvem null para %s", (_label, valor) => {
    // Os três têm que concordar — `normalizePhone` (front), `normalizeBrazilianPhone`
    // (dispatch) e `normalizePhoneForSearch` (lead-service) espelham a mesma função
    // SQL, e o dia em que divergirem é o dia em que o mesmo lead existe duas vezes.
    expect(normalizePhone(valor as string | null)).toBeNull();
    expect(normalizeBrazilianPhone(valor as string | null)).toBeNull();
    expect(normalizePhoneForSearch(valor as string | null)).toBeNull();
  });

  it("REFUTAÇÃO: `''` NÃO colapsa contatos via normalized_phone — o mecanismo é outro", () => {
    // O ⚠️ de `buildInboundChannelMessageRow` e a decisão 8 do plano dizem que
    // `normalizePhone('')` devolve `''` e que `''` casa com `''`, colapsando todos
    // os contatos de Instagram num só. Isso NÃO é verdade em nenhuma das três
    // camadas: TS devolve `null` (asserido acima) e o SQL devolve NULL logo na
    // primeira linha do corpo.
    expect(BASELINE).toMatch(/IF phone IS NULL OR phone = ''\s*THEN\s*RETURN NULL;/);

    // E `normalized_phone` é coluna DERIVADA por trigger a partir de `phone`;
    // com NULL do normalizador, o índice único nem enxerga a linha (ele é
    // PARCIAL). Ou seja: o colapso descrito não acontece — e a conclusão do plano
    // (`phone` = NULL, nunca `''`) continua CERTA por outra razão, escrita abaixo.
    expect(BASELINE).toMatch(
      /CREATE UNIQUE INDEX "idx_leads_org_phone_unique"[\s\S]*?WHERE \(\("normalized_phone" IS NOT NULL\) AND \("deleted_at" IS NULL\)\)/,
    );
  });

  it("o dano REAL de `''` é o filtro `.is('phone', null)` do resgate de telefone", () => {
    // `useWhatsAppLeadIntegration` adota o telefone de uma conversa de WhatsApp
    // para o lead SÓ quando a coluna está NULL. Um lead nascido com `''` ficaria
    // para sempre fora desse UPDATE: telefone que o cliente informou depois nunca
    // entraria, e ninguém veria erro nenhum — o UPDATE casa zero linhas em
    // silêncio.
    const src = readFileSync(
      path.join(REPO, "src/modules/communication/hooks/useWhatsAppLeadIntegration.ts"),
      "utf8",
    );
    expect(src).toMatch(/\.is\("phone",\s*null\)/);
  });

  it("dois leads SEM telefone na mesma org não colidem — o índice de `leads` não guarda nada", () => {
    // Consequência direta do índice PARCIAL: `idx_leads_org_phone_unique` ignora
    // linhas com `normalized_phone` NULL. Portanto ele NÃO é guarda de unicidade
    // para lead de Instagram, e a fatia não pode se apoiar nele.
    //
    // É esta ausência que obriga a unicidade a morar na tabela de identidade —
    // e obriga o INSERT do lead e o da identidade a estarem na MESMA transação,
    // senão dois cliques produzem dois leads e nada os pega.
    // (A guarda em si é asserida em `notificame-lead-link-rpc.test.ts`.)
    expect(normalizePhone(null)).toBeNull();
    expect(BASELINE).toMatch(/WHERE \(\("normalized_phone" IS NOT NULL\)/);
  });
});

// ─── B.1 disparo: fecha antes de qualquer I/O ───────────────────────────────

/** Dublê que ACUSA qualquer toque no banco. O ponto é provar que não houve. */
function adminQueAcusa() {
  const from = vi.fn(() => {
    throw new Error("o banco foi aberto antes do guard de telefone");
  });
  const rpc = vi.fn(() => {
    throw new Error("RPC chamada antes do guard de telefone");
  });
  return { from, rpc };
}

describe("B.1 o disparo de WhatsApp recusa o lead sem telefone, fail-closed", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string vazia", ""],
    ["um @handle no lugar do número", "@fulana"],
  ])("phone = %s ⇒ DispatchResolutionError('missing_phone') sem tocar no banco", async (_l, phone) => {
    const admin = adminQueAcusa();

    await expect(
      resolveDispatchContext(admin as never, {
        organization_id: ORG,
        phone: phone as string | null,
      }),
    ).rejects.toBeInstanceOf(DispatchResolutionError);

    // A ordem importa: o guard é a PRIMEIRA linha da função. Se ele descesse para
    // depois da resolução de instância, cada lead de Instagram custaria consultas
    // e o erro chegaria no operador como "non-2xx status code".
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("o código do erro é acionável — `missing_phone`, não um TypeError", async () => {
    // O chamador (workflow-executor, campanha, follow-up) só consegue transformar
    // isso em mensagem útil se o código chegar íntegro.
    await expect(
      resolveDispatchContext(adminQueAcusa() as never, { organization_id: ORG, phone: null }),
    ).rejects.toMatchObject({ code: "missing_phone", message: "Lead has no phone" });
  });

  it("CONTROLE POSITIVO: com telefone válido o guard NÃO dispara — falha adiante", async () => {
    // Sem este caso, os anteriores passariam numa função que rejeitasse tudo. Aqui
    // o telefone atravessa o guard, o banco É consultado, e a falha vira
    // `no_instance` — outro código, outro problema.
    // Query-builder fiel (mesma forma do dublê de `notificame-instagram-isolation`):
    // encadeia eq/in/is/order/limit sobre uma tabela VAZIA de instâncias.
    const builder = () => {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        in: () => api,
        is: () => api,
        order: () => api,
        limit: () => api,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return api;
    };
    const admin = {
      from: vi.fn(() => builder()),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    };

    await expect(
      resolveDispatchContext(admin as never, {
        organization_id: ORG,
        phone: "11987654321",
        require_connected: true,
      }),
    ).rejects.toMatchObject({ code: "no_instance" });

    expect(admin.from).toHaveBeenCalled();
  });
});

// ─── B.2 a ficha e o card: o que some, e o que NÃO some ─────────────────────

describe("B.2 superfícies de WhatsApp diante de um lead sem telefone", () => {
  it.each([
    ["undefined", undefined],
    ["string vazia", ""],
    ["@handle", "@fulana"],
    ["IGSID", "17841400000000000"],
  ])("formatPhoneForWhatsApp(%s) ⇒ null, então `hasPhone` é false", (_l, valor) => {
    // `hasPhone` do LeadCard é literalmente `!!formatPhoneForWhatsApp(lead.phone)`.
    // O IGSID é o caso afiado: 17 dígitos, passaria por qualquer teste de
    // "parece número" — e aqui morre no DDD e no nono dígito.
    expect(formatPhoneForWhatsApp(valor as string | undefined)).toBeNull();
  });

  it("CONTROLE POSITIVO: um celular BR de verdade continua abrindo o WhatsApp", () => {
    expect(formatPhoneForWhatsApp("11987654321")).toBe("5511987654321");
  });

  it("as ações de WhatsApp do LeadCard são gateadas por hasPhone", () => {
    const src = readFileSync(
      path.join(REPO, "src/modules/leads/components/leads/LeadCard.tsx"),
      "utf8",
    );
    expect(src).toMatch(/const hasPhone = !!formatPhoneForWhatsApp\(/);
    // TRÊS pontos de uso: item do menu, botão da linha de ações rápidas e o
    // slot lateral de WhatsApp do card no formato DataCrazy. O terceiro nasceu
    // com o redesenho do card — e nasceu gateado, que é o que este teste
    // guarda. O número aqui é o de superfícies de WhatsApp no arquivo: se
    // subir, a superfície nova precisa do gate; se cair, alguma sumiu.
    expect(src.match(/\{hasPhone && \(/g) ?? []).toHaveLength(3);
  });

  it("BURACO CONHECIDO: 'Agendar mensagem' NÃO é gateado e recebe `phone || \"\"`", () => {
    // Este caso documenta um defeito de HOJE que a fatia MULTIPLICA — hoje quase
    // todo lead tem telefone; com Instagram, leads sem telefone viram rotina.
    // O item abre `ScheduleMessageModal` com `phoneNumber={lead.phone || ""}`:
    // agenda uma mensagem que nunca sai, e o operador só descobre no dia.
    //
    // Está fora de escopo por decisão (é fatia própria). Fica VERMELHO no dia em
    // que alguém corrigir — e nesse dia o certo é apagar este caso, não o gate.
    const src = readFileSync(
      path.join(REPO, "src/modules/leads/components/leads/LeadCard.tsx"),
      "utf8",
    );
    expect(src).toMatch(/Agendar mensagem/);
    expect(src).toMatch(/phoneNumber=\{lead\.phone \|\| ""\}/);
    // A prova de que NÃO é gateado: o item de agendar não está dentro de um
    // bloco `{hasPhone && (`.
    const trecho = src.slice(src.indexOf("Agendar mensagem") - 400, src.indexOf("Agendar mensagem"));
    expect(trecho).not.toMatch(/\{hasPhone && \($/);
  });
});

// ─── B.3 mapa de UF: o lead entra, e entra como "não mapeado" ───────────────

describe("B.3 o mapa de UF conta o lead sem DDD como não-mapeado", () => {
  it("get_uf_heatmap deriva a UF do DDD e tem a gaveta `unmapped_count`", () => {
    // Não é quebra: é omissão. Com volume de Instagram, `unmapped_count` cresce e
    // nenhuma tela explica por quê — o mapa passa a mentir por silêncio sobre a
    // distribuição geográfica da base.
    expect(BASELINE).toMatch(/CREATE OR REPLACE FUNCTION "public"\."get_uf_heatmap"/);
    expect(BASELINE).toMatch(/"unmapped_count" bigint/);
  });
});
