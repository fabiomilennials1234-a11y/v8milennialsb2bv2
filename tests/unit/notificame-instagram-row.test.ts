/**
 * Fatia 1.1 — ONDE o canal de Instagram é gravado, e com QUE rótulo.
 *
 * A decisão A.7 é o eixo desta fatia: o canal social NÃO mora em
 * `whatsapp_instances`. Mora em `messaging_channels`, tabela nova cujo CHECK
 * recusa `channel_type='whatsapp'` de propósito. A fronteira é o TIPO DE CANAL,
 * não o vendor — canal WhatsApp do NotificaMe continua onde já está, e nenhuma
 * linha existente muda de lugar.
 *
 * Este arquivo tranca os dois lados dessa decisão:
 *
 *   • `buildMessagingChannelRow` — a linha certa, com os campos certos. A
 *     asserção central não é o formato: é que `JSON.stringify` da linha INTEIRA
 *     não contém a palavra "WhatsApp". Esse é literalmente o defeito que a opção
 *     descartada produziria — `buildNotificameInstanceRow` chumba
 *     `WhatsApp Oficial ${…}`, então uma conta de Instagram apareceria para o
 *     cliente com o nome "WhatsApp Oficial 3f2a1b9c" e telefone nulo.
 *
 *   • `buildNotificameInstanceRow` — o GUARD. Canal social que chegue nela
 *     LANÇA. É a rede contra um bug futuro no ramo de escrita do finish, onde os
 *     dois caminhos ficam a poucas linhas um do outro. Sem o guard, o defeito é
 *     SILENCIOSO: a linha é válida para o banco (o CHECK e o índice único de
 *     `whatsapp_instances` aceitam), aparece em 13 superfícies de front que só
 *     sabem falar de número, e come uma vaga PAGA de `max_whatsapp_instances`,
 *     que a quota conta sem filtrar provider.
 *
 * E o eixo de credencial, que vale para as duas: nem `provider_config` nem
 * qualquer campo da linha pode carregar o `company_uuid`/token da subconta. As
 * duas tabelas são lidas sob RLS por QUALQUER membro da org — inclusive quem não
 * tem `whatsapp.manage_instances` —, então carimbar o token numa delas vaza a
 * credencial da org para todo o time do cliente, e ela NÃO É ROTACIONÁVEL.
 *
 * Sem rede, sem banco.
 */
import { describe, it, expect } from "vitest";
import {
  buildMessagingChannelRow,
  buildNotificameInstanceRow,
  type NotificameChannel,
} from "../../supabase/functions/_shared/notificame";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";
/** O `id` da LINHA do cofre — referência, jamais o token. */
const SUBACCOUNT_ROW_ID = "11111111-2222-3333-4444-555555555555";
/**
 * O token/`company_uuid` da subconta. Ele NÃO é passado para nenhuma das duas
 * funções — e é exatamente por isso que ele está declarado aqui: a asserção de
 * não-vazamento precisa de uma string concreta para procurar.
 */
const SUBACCOUNT_TOKEN = "cu_TOKEN_SECRETO_DA_SUBCONTA_9f8e7d";
const NOW = new Date("2026-08-14T12:00:00.000Z");

const igChannel: NotificameChannel = {
  id: "3f2a1b9c-aaaa-bbbb-cccc-ddddeeeeffff",
  name: "Milennials Oficial",
  phone: null,
  type: "instagram",
  status: "connected",
};

// ── 1. buildMessagingChannelRow — a linha certa ──────────────────────────────

describe("buildMessagingChannelRow — o canal IG é gravado em messaging_channels", () => {
  it("devolve exatamente as colunas insertáveis da tabela, com os valores certos", () => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: igChannel,
      channelType: "instagram",
      now: NOW,
    });

    expect(row).toEqual({
      organization_id: ORG,
      provider: "notificame",
      channel_type: "instagram",
      // O id do canal NO FORNECEDOR — a coluna que carrega o índice único GLOBAL
      // `uq_messaging_channels_external`, última linha de defesa contra vínculo
      // cross-tenant. Vem de `channel.id` e de mais lugar nenhum.
      external_channel_id: igChannel.id,
      subaccount_id: SUBACCOUNT_ROW_ID,
      display_name: "Milennials Oficial",
      handle: null,
      status: "connected",
      provider_config: {
        vendor: "notificame",
        connected_via: "seamless_v2",
        connected_at: "2026-08-14T12:00:00.000Z",
      },
      connected_at: "2026-08-14T12:00:00.000Z",
    });
  });

  it("sem nome no fornecedor, o rótulo é 'Instagram <8 chars do id>' — nunca vazio", () => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: { ...igChannel, name: null },
      channelType: "instagram",
      now: NOW,
    });

    // `display_name` é NOT NULL e tem índice único por org: string vazia viraria
    // colisão na segunda conexão da org, com erro que ninguém liga ao nome.
    expect(row.display_name).toBe("Instagram 3f2a1b9c");
    expect(row.display_name.trim().length).toBeGreaterThan(0);
  });

  it.each([
    ["nome só com espaço", "   "],
    ["nome vazio", ""],
  ])("%s cai no rótulo derivado do id", (_label, name) => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: { ...igChannel, name },
      channelType: "instagram",
      now: NOW,
    });
    expect(row.display_name).toBe("Instagram 3f2a1b9c");
  });

  it("facebook usa o rótulo 'Facebook' — o CHECK da tabela já comporta os dois", () => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: { ...igChannel, name: null, type: "facebook" },
      channelType: "facebook",
      now: NOW,
    });
    expect(row.channel_type).toBe("facebook");
    expect(row.display_name).toBe("Facebook 3f2a1b9c");
  });

  it("`handle` nasce NULL — não se inventa @usuário a partir do nome de exibição", () => {
    // `GET /v1/channels` não devolve o handle. Derivá-lo do `name` mostraria como
    // identidade verificada um texto que o dono da conta escolheu.
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: { ...igChannel, name: "@nao_e_handle" },
      channelType: "instagram",
      now: NOW,
    });
    expect(row.handle).toBeNull();
  });
});

// ── 2. a asserção que dá nome ao arquivo ─────────────────────────────────────

describe("o rótulo é o ponto — nenhuma palavra de WhatsApp na linha de um canal IG", () => {
  it.each([
    ["com nome do fornecedor", "Milennials Oficial"],
    ["sem nome", null],
  ])("JSON.stringify da linha inteira (%s) não contém 'whatsapp'", (_label, name) => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: { ...igChannel, name },
      channelType: "instagram",
      now: NOW,
    });

    // Esta é a asserção pela qual a função existe separada, em vez de um
    // parâmetro a mais em `buildNotificameInstanceRow`. Reprovar aqui significa
    // que o cliente veria a conta de Instagram dele nomeada como um número de
    // WhatsApp — o defeito exato da opção que a decisão A.7 descartou.
    expect(JSON.stringify(row).toLowerCase()).not.toContain("whatsapp");
    // E nada de "número"/"numero": canal social não tem telefone.
    expect(JSON.stringify(row).toLowerCase()).not.toMatch(/n[úu]mero/);
  });

  it("controle positivo: a MESMA asserção reprova na linha de whatsapp_instances", () => {
    // Sem este caso, o teste acima passaria numa implementação que devolvesse
    // `{}`. Aqui se prova que a busca por "whatsapp" ENCONTRA quando deve.
    const waRow = buildNotificameInstanceRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: { id: "ch_wa", name: null, phone: null, type: "whatsapp" },
      now: NOW,
    });
    expect(JSON.stringify(waRow).toLowerCase()).toContain("whatsapp");
  });

  it("a linha NÃO tem as colunas de whatsapp_instances — não é a mesma forma", () => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: igChannel,
      channelType: "instagram",
      now: NOW,
    });
    const keys = Object.keys(row);

    // `instance_name` e `phone_number` são o vocabulário de número de WhatsApp.
    // Se aparecerem aqui, alguém está a um passo de fundir as duas tabelas.
    expect(keys).not.toContain("instance_name");
    expect(keys).not.toContain("phone_number");
    expect(keys).not.toContain("instance_id");
    // `channel_id` é o nome que o jsonb de `whatsapp_instances` usa; aqui a
    // identidade do canal é COLUNA, com nome próprio e índice único.
    expect(keys).not.toContain("channel_id");
    expect(keys).toContain("external_channel_id");
  });
});

// ── 3. credencial — nada de token em tabela lida sob RLS pela org inteira ────

describe("não-vazamento: o token da subconta não entra na linha", () => {
  it("nenhum campo da linha contém o company_uuid/token, nem por acidente", () => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      // Fixture HOSTIL: o fornecedor devolve campos que não pedimos. Se a função
      // fizesse spread do canal, o token entraria por aqui.
      channel: {
        ...igChannel,
        ...({ company_uuid: SUBACCOUNT_TOKEN, token: SUBACCOUNT_TOKEN } as Record<string, unknown>),
      } as NotificameChannel,
      channelType: "instagram",
      now: NOW,
    });

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(SUBACCOUNT_TOKEN);
    expect(serialized).not.toContain("company_uuid");
    expect(serialized).not.toContain("token");
  });

  it("provider_config carrega procedência e mais nada", () => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: igChannel,
      channelType: "instagram",
      now: NOW,
    });

    // Fechado, não "contém": um jsonb que aceita chaves extras é onde a
    // credencial reaparece no refactor seguinte.
    expect(Object.keys(row.provider_config).sort()).toEqual([
      "connected_at",
      "connected_via",
      "vendor",
    ]);
    // A referência ao cofre é COLUNA (com FK e ON DELETE RESTRICT). Duplicá-la no
    // jsonb criaria dois estados que divergem.
    expect(row.provider_config).not.toHaveProperty("subaccount_id");
  });

  it("`subaccount_id` é o UUID DA LINHA do cofre, não o token", () => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: igChannel,
      channelType: "instagram",
      now: NOW,
    });
    expect(row.subaccount_id).toBe(SUBACCOUNT_ROW_ID);
    expect(row.subaccount_id).not.toBe(SUBACCOUNT_TOKEN);
  });

  it("organization_id vem do parâmetro (auth validado), nunca de campo do canal", () => {
    const row = buildMessagingChannelRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: {
        ...igChannel,
        ...({ organization_id: "org-do-atacante" } as Record<string, unknown>),
      } as NotificameChannel,
      channelType: "instagram",
      now: NOW,
    });
    expect(row.organization_id).toBe(ORG);
  });
});

// ── 4. o guard de buildNotificameInstanceRow ─────────────────────────────────

describe("buildNotificameInstanceRow LANÇA para canal social", () => {
  const build = (type: string | null) =>
    buildNotificameInstanceRow({
      organizationId: ORG,
      subaccountId: SUBACCOUNT_ROW_ID,
      channel: { id: "3f2a1b9c-aaaa", name: null, phone: null, type },
      now: NOW,
    });

  it.each(["instagram", "Instagram", "INSTAGRAM", "ig", "IG"])(
    "type=%o ⇒ lança em vez de produzir 'WhatsApp Oficial 3f2a1b9'",
    (type) => {
      // O guard usa `normalizeSeamlessType`, então a caixa e o alias do
      // fornecedor não o contornam. Sem isso, o defeito é SILENCIOSO: a linha é
      // válida para o banco e só aparece como uma conta de Instagram chamada
      // "WhatsApp Oficial" na tela do cliente.
      expect(() => build(type)).toThrow();
    },
  );

  it.each(["facebook", "fb", "messenger"])("type=%o também lança", (type) => {
    expect(() => build(type)).toThrow();
  });

  it("o erro identifica a causa — não é um TypeError genérico de refactor", () => {
    // Quem ler o log tem que saber POR QUE, senão o próximo passo é apagar o
    // guard em vez de corrigir o ramo de escrita.
    expect(() => build("instagram")).toThrow(
      expect.objectContaining({ code: "channel_type_mismatch" }),
    );
  });

  it("CONTROLE POSITIVO: type='whatsapp' segue produzindo a linha de hoje", () => {
    // Sem este caso, o guard poderia lançar para tudo e os quatro casos acima
    // passariam — verde por ausência com outra roupa.
    const row = build("whatsapp");
    expect(row.provider).toBe("notificame");
    expect(row.instance_name).toBe("WhatsApp Oficial 3f2a1b9c");
    expect(row.status).toBe("connected");
  });

  it.each([
    ["ausente (null)", null],
    ["desconhecido ('reels')", "reels"],
  ])("type %s NÃO lança — desconhecido degrada, não bloqueia", (_label, type) => {
    // Mesma regra do `pickNewChannel`: o discriminante vem de rota indocumentada.
    // Bloquear no desconhecido deixaria um canal faturável e irremovível órfão no
    // fornecedor. O guard barra o que RECONHECE como social, nunca a dúvida.
    expect(() => build(type)).not.toThrow();
  });
});
