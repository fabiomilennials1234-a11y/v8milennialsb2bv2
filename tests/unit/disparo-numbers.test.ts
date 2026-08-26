/**
 * disparo-numbers — o módulo ÚNICO de números do Disparo, com regime (#1722).
 *
 * Existe um Disparo, e a Instance escolhida decide o regime (ADR-0028 §1): Chip
 * manda texto livre, Canal Oficial manda Template aprovado. Antes desta fatia o
 * wizard escondia o número oficial e o Disparo Rápido o oferecia e quebrava,
 * porque cada tela decidia por conta própria — três implementações da mesma
 * pergunta, medidas em `.specs/blast/PLANO-1722.md` §2.1.
 *
 * O seam é este módulo: dada a lista de Instances da Organization, QUAIS
 * aparecem e com QUE regime. Se as telas divergirem de novo, é aqui que falha.
 */
import { describe, it, expect } from "vitest";
import {
  instancesToNumbers,
  isConnectedInstance,
  isBlastableInstance,
  regimeDaInstancia,
  NEW_NUMBER_WINDOW_DAYS,
  type InstanceLike,
} from "@/shared/disparo/disparo-numbers";
import {
  NEW_NUMBER_CAP,
  CAP_RECOMMENDED,
} from "@/shared/disparo/speed-safety";
import { getProviderProfile } from "@/modules/communication";

const NOW = Date.parse("2026-08-23T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

describe("regime do número", () => {
  it("Organization só com Canal Oficial: o número aparece, com regime oficial", () => {
    // O caso que não existia: a Chique tem o número oficial "Chiquê", e as
    // Organizations novas nascem oficiais. Antes desta fatia a lista vinha
    // VAZIA e a tela não explicava nada (ADR-0028 §Context).
    const instances: InstanceLike[] = [
      {
        id: "nm",
        instance_name: "Chiquê",
        status: "connected",
        provider: "notificame",
        created_at: "2025-01-01T00:00:00Z",
      },
    ];

    const nums = instancesToNumbers(instances, NOW);

    expect(nums.map((n) => n.id)).toEqual(["nm"]);
    expect(nums[0].regime).toBe("oficial");
  });

  it("um canal de Instagram do MESMO provedor não vira número", () => {
    // A armadilha que o regime novo abre. Um canal social de `messaging_channels`
    // nasce com `provider: "notificame"` e `status: "connected"`
    // (`_shared/notificame.ts:1460-1475`) — a MESMA dupla que agora qualifica o
    // Canal Oficial. Sem discriminador, ele apareceria como número de Disparo, e
    // o Disparo tentaria mandar Template de WhatsApp por um Direct de Instagram.
    //
    // É a regressão que `tests/unit/notificame-instagram-isolation.test.ts`
    // existe para impedir; aqui ela é vigiada no módulo que herdou a decisão.
    const instances: InstanceLike[] = [
      {
        id: "mc-ig",
        instance_name: "Milennials Oficial",
        status: "connected",
        provider: "notificame",
        channel_type: "instagram",
      },
      { id: "nm", instance_name: "Chiquê", status: "connected", provider: "notificame" },
    ];

    // CONTROLE POSITIVO embutido: o número oficial de WhatsApp continua vindo,
    // então a exclusão acima não é o mapeador quebrado.
    expect(instancesToNumbers(instances, NOW).map((n) => n.id)).toEqual(["nm"]);
  });
});

// ── Regime Chip: comportamento IDÊNTICO ao de hoje (critério 8) ─────────────
//
// Portado de `disparo-instances-to-numbers.test.ts` (#908), que morreu junto com
// o módulo que testava. Nenhum caso foi perdido no caminho: o que mudou de
// veredito foi só o `notificame`, e ele tem caso próprio dizendo por quê.

describe("isConnectedInstance", () => {
  it("aceita open / connected (case-insensitive), recusa o resto", () => {
    expect(isConnectedInstance({ id: "1", status: "open" })).toBe(true);
    expect(isConnectedInstance({ id: "2", status: "CONNECTED" })).toBe(true);
    expect(isConnectedInstance({ id: "3", status: "disconnected" })).toBe(false);
    expect(isConnectedInstance({ id: "4", status: null })).toBe(false);
  });
});

describe("instancesToNumbers — regime Chip", () => {
  it("mantém só as linhas conectadas e seleciona a primeira", () => {
    const instances: InstanceLike[] = [
      { id: "a", instance_name: "Comercial", status: "open", provider: "uazapi", created_at: daysAgo(90) },
      { id: "b", instance_name: "Desligado", status: "disconnected", provider: "uazapi", created_at: daysAgo(90) },
      { id: "c", instance_name: "Suporte", status: "connected", provider: "evolution", created_at: daysAgo(90) },
    ];
    const nums = instancesToNumbers(instances, NOW);
    expect(nums.map((n) => n.id)).toEqual(["a", "c"]);
    expect(nums.map((n) => n.regime)).toEqual(["chip", "chip"]);
    expect(nums[0].selected).toBe(true);
    expect(nums[1].selected).toBe(false);
    expect(nums[0].cap).toBe(CAP_RECOMMENDED);
    expect(nums[0].isNew).toBe(false);
  });

  it("marca e clampa uma linha recém-conectada", () => {
    const [n] = instancesToNumbers(
      [{ id: "new", instance_name: "Recém", status: "open", provider: "uazapi", created_at: daysAgo(NEW_NUMBER_WINDOW_DAYS - 1) }],
      NOW,
    );
    expect(n.isNew).toBe(true);
    expect(n.cap).toBe(NEW_NUMBER_CAP);
  });

  it("cai para o telefone e depois para um rótulo posicional", () => {
    const instances: InstanceLike[] = [
      { id: "a", instance_name: null, phone_number: "5511999", status: "open", provider: "uazapi" },
      { id: "b", instance_name: "", phone_number: null, status: "open", provider: "uazapi" },
    ];
    const nums = instancesToNumbers(instances, NOW);
    expect(nums[0].label).toBe("5511999");
    expect(nums[1].label).toBe("Número 2");
  });

  it("linha sem created_at não é nova", () => {
    const [n] = instancesToNumbers([{ id: "a", status: "open", provider: "uazapi" }], NOW);
    expect(n.isNew).toBe(false);
  });
});

// ── Fail-closed: o que continua fora ────────────────────────────────────────

describe("instancesToNumbers — fail-closed", () => {
  it("linha sem provider não dispara", () => {
    expect(instancesToNumbers([{ id: "a", status: "open" }], NOW)).toEqual([]);
    expect(regimeDaInstancia({ id: "a", status: "open" })).toBeNull();
  });

  it("provider novo e desconhecido nasce excluído", () => {
    expect(instancesToNumbers([{ id: "x", status: "connected", provider: "provider_do_futuro" }], NOW)).toEqual([]);
  });

  it("provider em CAIXA ALTA continua disparando — case-insensitive como sempre foi", () => {
    // REGRESSÃO PEGA PELO /code-review. O módulo antigo normalizava o case
    // (`instances-to-numbers.ts:49`, `BLASTABLE_PROVIDERS.has(provider.toLowerCase())`)
    // e a minha reescrita não — um `provider: "Uazapi"` passaria a cair no
    // fail-closed e a Organization ficaria SEM NÚMERO NENHUM, sem explicação.
    // Critério 8 é comportamento idêntico, e isto não era.
    expect(regimeDaInstancia({ id: "a", status: "open", provider: "UAZAPI" })).toBe("chip");
    expect(regimeDaInstancia({ id: "b", status: "open", provider: "Evolution" })).toBe("chip");
    expect(regimeDaInstancia({ id: "c", status: "open", provider: "NotificaMe" })).toBe("oficial");
    expect(
      instancesToNumbers([{ id: "a", status: "OPEN", provider: "Uazapi" }], NOW).map((n) => n.id),
    ).toEqual(["a"]);
  });

  it("meta_cloud continua fora — é oficial, mas não tem transporte de Disparo nesta fatia", () => {
    // Não é "esqueceram": o transporte desta fatia é o do NotificaMe
    // (`sendTemplateViaInstance` → `NotificameProvider.sendTemplate`). Oferecer
    // o número da Meta direto seria oferecer um envio que ninguém sabe fazer.
    expect(regimeDaInstancia({ id: "m", status: "connected", provider: "meta_cloud" })).toBeNull();
  });
});

// ── Organization com os dois números (a Chique) ─────────────────────────────

describe("instancesToNumbers — Chip e Canal Oficial na mesma Organization", () => {
  it("oferece os dois, cada um com seu regime", () => {
    // A Chique tem o oficial "Chiquê" e o chip "Carol". É o campo de teste de
    // toda regra de regime (spec #1719 §Further Notes).
    const instances: InstanceLike[] = [
      { id: "carol", instance_name: "Carol", status: "open", provider: "uazapi" },
      { id: "chique", instance_name: "Chiquê", status: "connected", provider: "notificame" },
    ];
    const nums = instancesToNumbers(instances, NOW);
    expect(nums.map((n) => [n.id, n.regime])).toEqual([
      ["carol", "chip"],
      ["chique", "oficial"],
    ]);
  });
});

// ── Gêmeo: as duas verdades sobre provedor não podem divergir em silêncio ────

describe("gêmeo — regime x perfil de provedor", () => {
  it("todo provedor de CHIP é reconhecido pelo perfil, e nenhum oficial se disfarça de chip", () => {
    // Por que gêmeo e não derivação direta: `EVOLUTION.capabilities.massSend` é
    // `false` no perfil (`whatsapp-provider.ts:81`) e o Evolution ESTÁ na
    // allowlist de chip. Derivar o regime do perfil removeria o Evolution do
    // wizard — mudança de comportamento que o critério 8 proíbe. Então as duas
    // listas coexistem, e este teste é o que acusa a divergência que importa:
    // um provedor de chip não pode ser `official`, e um oficial não pode entrar
    // como chip.
    for (const provider of ["uazapi", "evolution"]) {
      expect(regimeDaInstancia({ id: "i", status: "open", provider })).toBe("chip");
      expect(getProviderProfile(provider as never).official).toBe(false);
    }

    const oficial = getProviderProfile("notificame" as never);
    expect(oficial.official).toBe(true);
    expect(oficial.capabilities.templates).toBe(true);
    expect(regimeDaInstancia({ id: "i", status: "open", provider: "notificame" })).toBe("oficial");
  });
});

// ── Guarda mecânica: UM módulo, duas telas (critério 2) ─────────────────────

describe("guarda — wizard e Disparo Rápido derivam do mesmo módulo", () => {
  // O defeito que o #1722 conserta não foi um filtro errado: foi CADA TELA
  // decidindo por conta própria. O wizard filtrava por provedor, o Disparo
  // Rápido não, e o vendedor descobria a diferença pela string crua
  // `notificame does not support senderAdvanced` (ADR-0028 §6).
  //
  // Teste de estrutura, e de propósito: comportamento se testa na borda, mas
  // "existe UMA fonte" não é comportamento — é a ausência de uma segunda. Só
  // se prova olhando o fonte. Prior art: `tests/unit/role-vocabulary.test.ts` e
  // a guarda de vocabulário do #1721.
  const TELAS = [
    "src/modules/campaigns/components/disparo-wizard/DisparoWizard.tsx",
    "src/modules/leads/components/bulk-actions/QuickBlastDialog.tsx",
  ];

  it.each(TELAS)("%s consulta o módulo único e não reimplementa o filtro", async (arquivo) => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(arquivo, "utf8");

    expect(src).toMatch(/instancesToNumbers/);

    // A cópia da lógica de "conectado" é a marca da divergência: era esta
    // linha, duplicada em três arquivos, que deixava os conjuntos diferentes.
    expect(src).not.toMatch(/new Set\(\s*\[\s*"open"\s*,\s*"connected"\s*\]/);
  });
});
