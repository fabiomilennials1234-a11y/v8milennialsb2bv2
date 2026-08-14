/**
 * Fatia 1.1 — nenhuma superfície de WhatsApp enxerga um canal de Instagram.
 *
 * Este arquivo é o teste da decisão A.7, e o que ele mede é diferente do que um
 * teste de filtro mediria. A opção descartada era gravar o canal social em
 * `whatsapp_instances` e proteger as pontas com guardas; ela custaria 13
 * superfícies de front e ~8 caminhos de edge revisados um a um, e o próximo
 * leitor esqueceria de replicar o filtro no 22º. A opção escolhida é ISOLAMENTO
 * POR CONSTRUÇÃO: o canal social mora em `messaging_channels`, e as superfícies
 * de WhatsApp não precisam de guarda nenhuma porque não leem essa tabela.
 *
 * Testar isolamento por construção exige uma asserção incomum — não basta provar
 * que o canal IG não é escolhido; é preciso provar que ele NEM É CONSULTADO. Por
 * isso o dublê aqui é indexado por TABELA e registra quais tabelas cada caminho
 * tocou. O dia em que alguém unificar as duas tabelas, ou fizer o dispatch ler
 * `messaging_channels` "só para checar", este arquivo fica vermelho.
 *
 * Três camadas, da mais forte para a mais fraca:
 *
 *   1. ESTRUTURAL — `resolveInstance` e `selectSendableInstance` (o motor de
 *      envio de copilot, follow-up, campanha e workflow) só leem
 *      `whatsapp_instances`. Um canal IG existe no banco e é invisível para elas.
 *   2. WIZARD DE DISPARO — `instancesToNumbers` não transforma um canal social em
 *      "número" selecionável. Uma linha de `messaging_channels` não tem sequer a
 *      forma de uma instância.
 *   3. BACKSTOP — mesmo numa REGRESSÃO em que um canal social acabasse dentro de
 *      `whatsapp_instances`, `getWhatsAppProvider` lança `Unknown provider` antes
 *      de qualquer I/O. É a rede, não o desenho: ela existe porque o caminho
 *      `preferredInstanceId` de `resolveInstance` é provider-CEGO (buraco
 *      pré-existente, documentado no caso correspondente).
 *
 * Sem rede. Deno é polyfillado, como em `meta-cloud-isolation.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

import {
  resolveInstance,
  selectSendableInstance,
} from "../../supabase/functions/_shared/whatsapp-dispatch.ts";
import {
  getWhatsAppProvider,
  type WhatsAppInstance,
} from "../../supabase/functions/_shared/whatsapp-client.ts";
import { buildMessagingChannelRow } from "../../supabase/functions/_shared/notificame";
import {
  instancesToNumbers,
  isBlastableInstance,
  type InstanceLike,
} from "@/modules/campaigns/components/disparo-wizard/instances-to-numbers";

const ORG = "org-a";

// ── dublê indexado por TABELA, com registro de quem foi consultado ───────────

type Row = Record<string, unknown>;

/**
 * Query-builder fiel: aplica eq/in/is/order/limit sobre um conjunto em memória,
 * e ANOTA cada tabela consultada. O registro é o que permite asserir ausência de
 * leitura — a única forma de testar isolamento por construção.
 */
function makeAdmin(tables: Record<string, Row[]>) {
  const touched: string[] = [];

  function builder(table: string) {
    let filtered = [...(tables[table] ?? [])];
    const api: Record<string, unknown> = {
      select: () => api,
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filtered = filtered.filter((r) => vals.includes(r[col]));
        return api;
      },
      is(col: string, val: unknown) {
        filtered = filtered.filter((r) => (r[col] ?? null) === val);
        return api;
      },
      order(col: string, opts: { ascending?: boolean } = {}) {
        const asc = opts.ascending !== false;
        filtered.sort((a, b) => {
          const av = a[col] as string;
          const bv = b[col] as string;
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (asc ? 1 : -1);
        });
        return api;
      },
      limit(n: number) {
        filtered = filtered.slice(0, n);
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
    };
    return api;
  }

  return {
    touched,
    client: {
      from(table: string) {
        touched.push(table);
        return builder(table);
      },
    },
  };
}

/** A linha real que a 1.1 grava — construída pela função de produção, não à mão. */
const IG_CHANNEL_ROW = {
  id: "mc-uuid-1",
  ...buildMessagingChannelRow({
    organizationId: ORG,
    subaccountId: "cofre-uuid",
    channel: { id: "ch_ig", name: "Milennials Oficial", phone: null, type: "instagram" },
    channelType: "instagram",
    now: new Date("2026-08-14T12:00:00.000Z"),
  }),
} as unknown as Row;

const UAZAPI_ROW: Row = {
  id: "uazapi-1",
  organization_id: ORG,
  provider: "uazapi",
  instance_name: "Comercial",
  phone_number: "5511988887777",
  status: "connected",
  created_at: "2025-01-01T00:00:00Z",
  last_connection_at: "2026-08-01T00:00:00Z",
  session_dead_since: null,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. o motor de envio ──────────────────────────────────────────────────────

describe("dispatch — o canal IG existe no banco e é invisível", () => {
  it("resolveInstance escolhe o número de WhatsApp e NUNCA consulta messaging_channels", () => {
    const admin = makeAdmin({
      whatsapp_instances: [UAZAPI_ROW],
      messaging_channels: [IG_CHANNEL_ROW],
    });

    return resolveInstance(admin.client as never, ORG, { requireConnected: true }).then((inst) => {
      expect(inst?.id).toBe("uazapi-1");
      // A asserção que mede o DESENHO, e não o filtro: a tabela do canal social
      // não foi nem lida. É isso que dispensa guarda nas 13 superfícies.
      expect(admin.touched).not.toContain("messaging_channels");
      expect(new Set(admin.touched)).toEqual(new Set(["whatsapp_instances"]));
    });
  });

  it("org que SÓ tem canal de Instagram: o dispatch devolve null, não o canal social", async () => {
    // O desfecho certo é "esta org não tem número" — o chamador falha limpo com
    // `no_instance`. Devolver o canal de Instagram faria um follow-up de texto
    // livre ser roteado para uma conta que não tem esse endpoint.
    const admin = makeAdmin({
      whatsapp_instances: [],
      messaging_channels: [IG_CHANNEL_ROW],
    });

    expect(await resolveInstance(admin.client as never, ORG, { requireConnected: true })).toBeNull();
    expect(admin.touched).not.toContain("messaging_channels");
  });

  it("selectSendableInstance idem — inclusive no fallback de liveness", async () => {
    // O fallback existe para relaxar `session_dead_since`; ele relaxa liveness e
    // NUNCA provider nem tabela.
    const admin = makeAdmin({
      whatsapp_instances: [],
      messaging_channels: [IG_CHANNEL_ROW],
    });

    expect(await selectSendableInstance(admin.client as never, ORG)).toBeNull();
    expect(admin.touched).not.toContain("messaging_channels");
    // Duas consultas (viva + fallback), as duas na mesma tabela.
    expect(admin.touched.every((t) => t === "whatsapp_instances")).toBe(true);
  });

  it("CONTROLE POSITIVO: com um número vivo, selectSendableInstance devolve ele", async () => {
    // Sem este caso, os três acima passariam num dublê que devolve `null` para
    // tudo — verde por ausência.
    const admin = makeAdmin({
      whatsapp_instances: [UAZAPI_ROW],
      messaging_channels: [IG_CHANNEL_ROW],
    });

    const inst = await selectSendableInstance(admin.client as never, ORG);
    expect(inst?.id).toBe("uazapi-1");
  });
});

// ── 2. wizard de Disparo ─────────────────────────────────────────────────────

describe("wizard de Disparo — canal IG não vira 'número' selecionável", () => {
  it("uma linha de messaging_channels não é blastável nem produz um DisparoNumber", () => {
    // A linha do canal social não tem sequer a FORMA de uma instância: sem
    // `provider` blastável, sem `status` no vocabulário de conexão de chip. O
    // mapeador é fail-closed, então ela sai vazia.
    expect(isBlastableInstance(IG_CHANNEL_ROW as unknown as InstanceLike)).toBe(false);
    expect(instancesToNumbers([IG_CHANNEL_ROW as unknown as InstanceLike], Date.now())).toEqual([]);
  });

  it("nem mesmo o nome do canal vaza para a lista de números", () => {
    const numbers = instancesToNumbers(
      [IG_CHANNEL_ROW as unknown as InstanceLike, UAZAPI_ROW as unknown as InstanceLike],
      Date.now(),
    );

    // CONTROLE POSITIVO embutido: o número de WhatsApp continua aparecendo, então
    // a lista vazia acima não é o mapeador quebrado.
    expect(numbers).toHaveLength(1);
    expect(numbers[0].id).toBe("uazapi-1");
    expect(JSON.stringify(numbers)).not.toContain("Milennials Oficial");
    expect(JSON.stringify(numbers)).not.toContain("ch_ig");
  });
});

// ── 3. backstop: a regressão que o desenho torna improvável ──────────────────

describe("backstop — mesmo se um canal social entrasse em whatsapp_instances", () => {
  const admin = {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { whatsapp_provider_override: null }, error: null }),
        }),
      }),
    }),
  };

  // ⚠️ ESTE BLOCO MUDOU DE ALVO NESTA RODADA, e a mudança é substantiva.
  //
  // Quando foi escrito, 'notificame' NÃO era um provider de WhatsApp: qualquer
  // linha com esse provider caía no fail-closed genérico e morria com
  // `Unknown provider`. A rodada do provider de ENVIO tornou 'notificame' um
  // provider LEGÍTIMO de WhatsApp (canal oficial via BSP), então aquela asserção
  // passou a cobrar uma mensagem que só fazia sentido no mundo anterior — e
  // cobrá-la de volta significaria desligar o envio oficial.
  //
  // O INVARIANTE, porém, não mudou: um canal SOCIAL não pode sair pela rota de
  // WhatsApp. O que mudou é QUEM o segura, e o novo guarda é mais preciso que o
  // antigo — `whatsapp-client.ts` passou a recusar pelo `channel_type` declarado
  // (backstop explícito), em vez de recusar o provider inteiro por acidente.
  // Por isso os casos abaixo cobram o `channel_type`, que é o discriminante real,
  // e não mais o nome do provider.

  it("recusa uma linha notificame que declara channel_type social (backstop de isolamento)", async () => {
    const bogus = {
      id: "regressao",
      organization_id: ORG,
      provider: "notificame",
      instance_name: "Instagram (regressão)",
      // É ISTO que distingue um canal social de um canal oficial de WhatsApp —
      // não o provider, que agora os dois compartilham.
      provider_config: { channel_id: "ch_ig", channel_type: "instagram" },
    } as unknown as WhatsAppInstance;

    await expect(getWhatsAppProvider(bogus, admin as never)).rejects.toThrow(
      /is not a whatsapp channel/,
    );
    // Lança ANTES de qualquer I/O — nem o RPC de credencial da Uazapi é tocado.
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("recusa uma linha notificame sem channel_id — sem `from`, não há envelope possível", async () => {
    const bogus = {
      id: "regressao",
      organization_id: ORG,
      provider: "notificame",
      instance_name: "Instagram (regressão)",
    } as unknown as WhatsAppInstance;

    await expect(getWhatsAppProvider(bogus, admin as never)).rejects.toThrow(
      /has no provider_config\.channel_id/,
    );
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("CONTROLE POSITIVO: provider desconhecido de verdade ainda morre em 'Unknown provider'", async () => {
    // Sem este caso, os dois acima passariam numa implementação que rejeitasse
    // TUDO — inclusive o canal oficial legítimo. Ele prova que o fail-closed
    // genérico continua de pé para o que ninguém declarou, que era a outra
    // metade do valor do teste original.
    const bogus = {
      id: "regressao",
      organization_id: ORG,
      provider: "provider_que_ninguem_declarou",
    } as unknown as WhatsAppInstance;

    await expect(getWhatsAppProvider(bogus, admin as never)).rejects.toThrow(/[Uu]nknown provider/);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("o caminho preferredInstanceId de resolveInstance É provider-cego — buraco conhecido", async () => {
    // Registro honesto de um buraco PRÉ-EXISTENTE (o mesmo que o Meta Cloud já
    // enfrenta): o passo 1 de `resolveInstance` filtra por id + org e não por
    // provider. Se um canal social estivesse em `whatsapp_instances` e alguém
    // apontasse um agente para ele, a linha VOLTARIA daqui. Quem impede o envio é
    // o backstop acima, não este caminho.
    //
    // Este teste documenta o estado real; ele não aprova o buraco. Sob a decisão
    // A.7 ele é inalcançável, porque nenhuma linha de canal social existe nessa
    // tabela — e é por isso que a decisão vale mais que 21 filtros.
    const admin2 = makeAdmin({
      whatsapp_instances: [
        { id: "regressao", organization_id: ORG, provider: "notificame", status: "connected" },
      ],
    });

    const inst = await resolveInstance(admin2.client as never, ORG, {
      preferredInstanceId: "regressao",
      requireConnected: true,
    });

    expect(inst?.id).toBe("regressao");
    expect(inst?.provider).toBe("notificame");
  });
});
