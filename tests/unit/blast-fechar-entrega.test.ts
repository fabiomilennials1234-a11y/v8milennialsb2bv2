// @vitest-environment node
/**
 * O ciclo de entrega do Disparo pelo Canal Oficial (#1724) — a decisão de fechar
 * a linha do destinatário, e o casamento que chega até ela.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * A Meta cobra NA ENTREGA (ADR-0029). Enquanto a linha para em `sent` — que quer
 * dizer "aceito pela fila" — o produto não sabe quem recebeu e o custo realizado
 * não existe. Quem fecha é o callback de status.
 *
 * E o casamento NÃO é o óbvio. Medido em produção em 2026-08-24, 747 linhas de
 * saída com os dois ids preenchidos: `provider_message_id = external_id` em ZERO
 * delas. São espaços de identificador diferentes — o id da resposta do envio é
 * UUID, o estável que volta nos callbacks é base64 longo. Casar o callback direto
 * contra `blast_plan_recipients.provider_message_id` pelo id estável não acha
 * linha nenhuma, NUNCA, e o modo de falha é SILÊNCIO.
 *
 * O caminho que funciona, e que este módulo assume pronto:
 *
 *   callback --(duas chaves, por org)--> channel_messages
 *            --(external_id)-----------> blast_plan_recipients.provider_message_id
 *
 * A primeira seta já existe e está certa (`notificame-webhook/index.ts:1140-1163`).
 * A segunda é esta fatia.
 */
import { describe, expect, it, vi } from "vitest";

// `logRuntime` monta um cliente Supabase e lê env. Ele é não-fatal por dentro,
// mas dublá-lo aqui torna a asserção "registrou UMA falha" possível — e é essa
// asserção que impede o fechamento de falhar em silêncio, que é o modo de falha
// desta fatia inteira.
const registros = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: async (p: Record<string, unknown>) => {
    registros.push(p);
  },
}));

import {
  decidirFechamento,
  fecharLinhaDoDisparo,
  MOTIVO_DE_RECUSA_DO_CANAL,
} from "../../supabase/functions/_shared/quick-blast/fechar-entrega.ts";

const AGORA = new Date("2026-08-27T12:00:00.000Z");

describe("decidirFechamento — a regra, sem banco", () => {
  it("entrega fecha a linha enviada, e o custo previsto vira realizado", () => {
    expect(
      decidirFechamento({ status: "sent", estimated_cost: "0.3217" }, {
        status: "delivered",
        agora: AGORA,
      }),
    ).toEqual({
      acao: "escrever",
      patch: {
        status: "delivered",
        delivered_at: AGORA.toISOString(),
        actual_cost: "0.3217",
      },
    });
  });

  it("READ sem DELIVERED anterior TAMBÉM fecha como entregue", () => {
    // Callbacks chegam fora de ordem e podem se perder. Uma mensagem lida foi
    // entregue por definição — ignorar o READ deixaria a linha viva até a
    // varredura do TTL a encerrar como `unconfirmed`, 30 dias depois, afirmando
    // ausência de informação sobre uma mensagem que o cliente LEU.
    const d = decidirFechamento({ status: "sent", estimated_cost: null }, {
      status: "read",
      agora: AGORA,
    });
    expect(d.acao).toBe("escrever");
    expect(d.acao === "escrever" && d.patch.status).toBe("delivered");
  });

  it("custo previsto ausente vira realizado AUSENTE, nunca zero", () => {
    // Ninguém carimba preço ainda — a tabela de preços versionada é #1725. Zero
    // afirmaria "esta entrega foi de graça"; null diz "não sei quanto custou",
    // que é a verdade. Um total somado de zeros é um número errado que não
    // parece errado.
    const d = decidirFechamento({ status: "sent", estimated_cost: null }, {
      status: "delivered",
      agora: AGORA,
    });
    expect(d.acao === "escrever" && d.patch.actual_cost).toBeNull();
  });

  it("segunda entrega do mesmo envio não recobra", () => {
    expect(
      decidirFechamento({ status: "delivered", estimated_cost: "0.3217" }, {
        status: "delivered",
        agora: AGORA,
      }).acao,
    ).toBe("ignorar");
  });

  it("recusa marca a linha com o motivo do canal, e tira o custo", () => {
    expect(
      decidirFechamento({ status: "sent", estimated_cost: "0.3217" }, {
        status: "failed",
        agora: AGORA,
      }),
    ).toEqual({
      acao: "escrever",
      patch: {
        status: "failed",
        reason: MOTIVO_DE_RECUSA_DO_CANAL,
        actual_cost: null,
      },
    });
  });

  it("o motivo é do vocabulário canônico que a tela já traduz", () => {
    // `blast-recipient-view.ts:74-86` traduz invalid_number,
    // instance_disconnected e provider_rejected; o default nunca vaza código
    // cru. Traduzir 131050/131049/132015/132016/131042 em DECISÕES é #1726 — e o
    // código cru da Meta já fica persistido pelo próprio webhook em
    // channel_messages.raw_payload.status_event.
    expect(MOTIVO_DE_RECUSA_DO_CANAL).toBe("provider_rejected");
  });

  it("recusa DEPOIS de entregue ainda vale — foi a sequência real da Meta", () => {
    // 19/08, produção: SENT e, 2 segundos depois, ERROR 131053 para a MESMA
    // mensagem. `failed` fica fora da escala de progressão de propósito, no
    // webhook (`index.ts:1187-1189`) e aqui.
    expect(
      decidirFechamento({ status: "delivered", estimated_cost: "0.3217" }, {
        status: "failed",
        agora: AGORA,
      }).acao,
    ).toBe("escrever");
  });

  it("entrega atrasada NÃO apaga uma recusa", () => {
    expect(
      decidirFechamento({ status: "failed", estimated_cost: "0.3217" }, {
        status: "delivered",
        agora: AGORA,
      }).acao,
    ).toBe("ignorar");
  });

  it("callback de `sent` não faz nada — o worker já marcou", () => {
    expect(
      decidirFechamento({ status: "sent", estimated_cost: null }, {
        status: "sent",
        agora: AGORA,
      }).acao,
    ).toBe("ignorar");
  });

  it.each(["pending", "skipped", "unconfirmed"] as const)(
    "linha em `%s` não é fechada por callback nenhum",
    (status) => {
      expect(
        decidirFechamento({ status, estimated_cost: null }, {
          status: "delivered",
          agora: AGORA,
        }).acao,
      ).toBe("ignorar");
      expect(
        decidirFechamento({ status, estimated_cost: null }, {
          status: "failed",
          agora: AGORA,
        }).acao,
      ).toBe("ignorar");
    },
  );
});

// ─── O I/O ───────────────────────────────────────────────────────────────────

interface Chamada {
  tabela: string;
  select?: string;
  filtros: Record<string, unknown>;
  patch?: Record<string, unknown>;
}

/**
 * Dublê de PostgREST no molde de `tests/helpers/supabase-mock.ts`: registra o
 * que foi pedido para que o teste possa afirmar sobre o FILTRO, não só sobre o
 * resultado. O guarda de tenant só é provável assim.
 */
function dubleDeBanco(opts: {
  linhas?: Record<string, unknown>[];
  erroNaBusca?: { message: string };
  erroNaEscrita?: { message: string };
}) {
  const chamadas: Chamada[] = [];

  const construir = (tabela: string) => {
    const chamada: Chamada = { tabela, filtros: {} };
    const q: Record<string, unknown> = {};
    q.select = (select: string) => {
      chamada.select = select;
      chamadas.push(chamada);
      return q;
    };
    q.update = (patch: Record<string, unknown>) => {
      chamada.patch = patch;
      chamadas.push(chamada);
      return q;
    };
    q.eq = (coluna: string, valor: unknown) => {
      chamada.filtros[coluna] = valor;
      return q;
    };
    q.limit = () =>
      Promise.resolve(
        opts.erroNaBusca
          ? { data: null, error: opts.erroNaBusca }
          : { data: opts.linhas ?? [], error: null },
      );
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        opts.erroNaEscrita
          ? { data: null, error: opts.erroNaEscrita }
          : { data: null, error: null },
      );
    return q;
  };

  return { admin: { from: (tabela: string) => construir(tabela) }, chamadas };
}

const destinatarioPadrao = () => ({
  id: "r1",
  status: "sent",
  estimated_cost: "0.3217",
});

const CALLBACK = {
  externalId: "610d05f8-2efd-4c1a-9f1e-1e0b8d9a7c33",
  organizationId: "6030520a-2ca7-477d-be89-55758e2cd808",
  status: "delivered" as const,
  agora: () => AGORA,
};

describe("fecharLinhaDoDisparo — o casamento e o guarda de tenant", () => {
  it("procura pelo external_id do envio, e com a org NO JOIN", async () => {
    // `blast_plan_recipients` NÃO tem organization_id (#1721) e o índice único de
    // provider_message_id é GLOBAL. Sem o join, um callback da org A fecharia a
    // linha da org B se o fornecedor repetisse id. Mutar o filtro de org para
    // fora tem de reprovar aqui.
    const { admin, chamadas } = dubleDeBanco({
      linhas: [{ id: "r1", status: "sent", estimated_cost: "0.3217" }],
    });

    await fecharLinhaDoDisparo(admin as never, CALLBACK);

    const busca = chamadas[0];
    expect(busca.tabela).toBe("blast_plan_recipients");
    expect(busca.select).toContain("blast_plans!inner(organization_id)");
    expect(busca.filtros["provider_message_id"]).toBe(CALLBACK.externalId);
    expect(busca.filtros["blast_plans.organization_id"]).toBe(CALLBACK.organizationId);
  });

  it("fecha a linha achada, escrevendo por id", async () => {
    const { admin, chamadas } = dubleDeBanco({
      linhas: [{ id: "r1", status: "sent", estimated_cost: "0.3217" }],
    });

    expect(await fecharLinhaDoDisparo(admin as never, CALLBACK)).toBe("fechada");

    const escrita = chamadas[1];
    expect(escrita.filtros["id"]).toBe("r1");
    expect(escrita.patch).toEqual({
      status: "delivered",
      delivered_at: AGORA.toISOString(),
      actual_cost: "0.3217",
    });
  });

  it("callback que não casa com linha nenhuma é silêncio, não erro e não linha nova", async () => {
    // O caso COMUM: quase todo callback de status do produto é de conversa
    // normal, não de Disparo. Não pode registrar por evento, não pode inserir,
    // não pode lançar (critério 6).
    registros.length = 0;
    const { admin, chamadas } = dubleDeBanco({ linhas: [] });

    expect(await fecharLinhaDoDisparo(admin as never, CALLBACK)).toBe("sem_linha");
    expect(chamadas).toHaveLength(1); // buscou, e parou
    expect(registros).toHaveLength(0);
  });

  it("callback de `sent` nem CONSULTA o banco", async () => {
    // `sent` chega para TODA mensagem que sai, de Disparo ou de conversa, e a
    // tabela de decisão diz que ele nunca faz nada. Consultar para descobrir isso
    // seria uma ida ao banco por evento, em troca de nada.
    const { admin, chamadas } = dubleDeBanco({ linhas: [destinatarioPadrao()] });

    expect(
      await fecharLinhaDoDisparo(admin as never, { ...CALLBACK, status: "sent" }),
    ).toBe("ignorado");
    expect(chamadas).toHaveLength(0);
  });

  it("linha achada mas sem nada a fazer não escreve", async () => {
    const { admin, chamadas } = dubleDeBanco({
      linhas: [{ id: "r1", status: "delivered", estimated_cost: "0.3217" }],
    });

    expect(await fecharLinhaDoDisparo(admin as never, CALLBACK)).toBe("ignorado");
    expect(chamadas).toHaveLength(1);
  });

  it("erro de banco não lança, e fica REGISTRADO — isto é dinheiro", async () => {
    // Uma entrega que não fechou é uma linha da fatura que o produto deixou de
    // contar. Falhar em silêncio aqui é o modo de falha mais caro desta fatia, e
    // por isso vai para `runtime_logs` e não para o log da edge function, que
    // rotaciona.
    registros.length = 0;

    const busca = dubleDeBanco({ erroNaBusca: { message: "conexão caiu" } });
    expect(await fecharLinhaDoDisparo(busca.admin as never, CALLBACK)).toBe("erro");

    const escrita = dubleDeBanco({
      linhas: [{ id: "r1", status: "sent", estimated_cost: null }],
      erroNaEscrita: { message: "deadlock" },
    });
    expect(await fecharLinhaDoDisparo(escrita.admin as never, CALLBACK)).toBe("erro");

    expect(registros).toHaveLength(2);
    expect(registros[0]).toMatchObject({
      module: "campaign",
      status: "error",
      organizationId: CALLBACK.organizationId,
    });
    // E sem PII: só ids. Nenhum telefone, nome ou conteúdo de mensagem.
    const snapshot = registros[1].payloadSnapshot as Record<string, unknown>;
    expect(Object.keys(snapshot).sort()).toEqual(
      ["callback_status", "erro", "external_id", "recipient_id"],
    );
  });

  it("o status do PLANO não entra na conta — entrega chega depois do fim do envio", async () => {
    // Critério 4. Nada neste caminho lê `blast_plans.status`: o único uso do
    // plano é o guarda de tenant. Um Disparo `completed` continua sendo
    // atualizado, e o custo realizado continua subindo.
    const { admin, chamadas } = dubleDeBanco({
      linhas: [{ id: "r1", status: "sent", estimated_cost: "0.0350" }],
    });

    expect(await fecharLinhaDoDisparo(admin as never, CALLBACK)).toBe("fechada");
    for (const c of chamadas) {
      expect(Object.keys(c.filtros)).not.toContain("blast_plans.status");
      expect(c.select ?? "").not.toContain("blast_plans!inner(organization_id,status)");
    }
  });
});
