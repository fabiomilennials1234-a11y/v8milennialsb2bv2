/**
 * decisao-do-disparo — a decisão de enviar, pular ou recusar, num lugar só (#1722).
 *
 * Critério 9 do ticket. A regra é PURA: sem I/O, sem relógio, sem provedor — dá
 * para lê-la inteira e testá-la sem banco. Prior art nomeada pela spec #1719
 * (§Testing Decisions, seam 2): `_shared/decisao-de-envio.ts` (#1689) e seu
 * gêmeo.
 *
 * As fatias seguintes acrescentam CAMPOS DE ENTRADA, não lugares de decisão:
 * supressão (#1727), teto de gasto (#1725), saúde da conta (#1728) e a
 * classificação dos erros da Meta (#1726) entram aqui, e em nenhum outro lugar.
 *
 * Três ações, e a diferença entre elas é o que acontece com a LINHA:
 *   enviar  → manda
 *   pular   → grava `skipped` na linha, com motivo: é ela que não vale
 *   recusar → NÃO toca na linha: é o Disparo que não pode partir agora
 */
import { describe, it, expect } from "vitest";
import { decidirDisparoDoDestinatario } from "../../supabase/functions/_shared/decisao-do-disparo.ts";

const PLANO_OK = {
  status: "active",
  template: { name: "boas_vindas", language: "pt_BR", components: [] },
};

const DESTINATARIO_OK = {
  status: "pending",
  phone: "5511999998888",
  // Reivindicada: é assim que a linha chega ao worker, sempre — o claim atômico
  // acontece ANTES, no RPC. Uma linha sem esta marca tem caso próprio abaixo.
  claimedAt: "2026-08-23T12:00:00Z",
};

describe("decidirDisparoDoDestinatario", () => {
  it("caminho feliz: destinatário pendente, plano ativo, template presente → enviar", () => {
    const d = decidirDisparoDoDestinatario({
      regime: "oficial",
      plano: PLANO_OK,
      destinatario: DESTINATARIO_OK,
    });

    expect(d.acao).toBe("enviar");
    expect(d.motivo).toBeNull();
  });
});

describe("a reivindicação é a idempotência (ADR-0028 §5)", () => {
  it("linha sem claim não é enviada — recusa, e não consome a linha", () => {
    // O fornecedor NÃO oferece chave de idempotência (ADR-0028 §5): a garantia
    // de envio único mora na linha, reivindicada ANTES do envio. Uma linha que
    // chega aqui sem `claimed_at` não passou pelo claim atômico — mandá-la é
    // apostar que nenhum outro tique a pegou. Aposta paga em mensagem duplicada
    // e cobrada.
    //
    // `recusar` e não `pular`: a linha não tem defeito nenhum, o defeito é do
    // caminho que a trouxe. Marcá-la `skipped` queimaria um destinatário são.
    const d = decidirDisparoDoDestinatario({
      regime: "oficial",
      plano: PLANO_OK,
      destinatario: { ...DESTINATARIO_OK, claimedAt: null },
    });

    expect(d.acao).toBe("recusar");
    expect(d.motivo).toMatch(/reivindic/i);
  });

  it("linha reivindicada segue para envio", () => {
    // CONTROLE POSITIVO: a recusa acima é da ausência do claim, não de tudo.
    const d = decidirDisparoDoDestinatario({
      regime: "oficial",
      plano: PLANO_OK,
      destinatario: { ...DESTINATARIO_OK, claimedAt: "2026-08-23T12:00:00Z" },
    });
    expect(d.acao).toBe("enviar");
  });
});

// ── A tabela inteira ────────────────────────────────────────────────────────

describe("recusas — o Disparo não parte, a linha fica intacta", () => {
  it("regime Chip: este worker não é o motor dele", () => {
    // O Chip continua no `/sender/*` da Uazapi (ADR-0028 §2, §Out of Scope).
    // Se uma linha de plano de Chip chegar a este worker, é engano de rota —
    // e enviar por aqui seria um segundo caminho de envio para o mesmo Disparo.
    const d = decidirDisparoDoDestinatario({
      regime: "chip",
      plano: PLANO_OK,
      destinatario: DESTINATARIO_OK,
    });
    expect(d.acao).toBe("recusar");
    expect(d.motivo).toMatch(/Chip/);
  });

  it.each(["paused", "cancelled", "completed"])(
    "plano %s: pausar é o worker parar de reivindicar",
    (status) => {
      const d = decidirDisparoDoDestinatario({
        regime: "oficial",
        plano: { ...PLANO_OK, status },
        destinatario: DESTINATARIO_OK,
      });
      expect(d.acao).toBe("recusar");
    },
  );

  it("plano oficial sem Template não parte", () => {
    const d = decidirDisparoDoDestinatario({
      regime: "oficial",
      plano: { status: "active", template: null },
      destinatario: DESTINATARIO_OK,
    });
    expect(d.acao).toBe("recusar");
    expect(d.motivo).toMatch(/Template/);
  });

  it("Template pela metade conta como ausente", () => {
    // Fail-closed: `{name: ""}` é forma de template sem template. Mandar isso ao
    // fornecedor devolve recusa por CALLBACK, depois do `success` — o modo de
    // falha mais caro que existe aqui (`whatsapp-dispatch.ts:379-391`).
    const d = decidirDisparoDoDestinatario({
      regime: "oficial",
      plano: { status: "active", template: { name: "  ", language: "pt_BR", components: [] } },
      destinatario: DESTINATARIO_OK,
    });
    expect(d.acao).toBe("recusar");
  });
});

describe("pulos — a linha não vale, e ela carrega o motivo", () => {
  it("destinatário sem telefone é pulado, não recusado", () => {
    const d = decidirDisparoDoDestinatario({
      regime: "oficial",
      plano: PLANO_OK,
      destinatario: { ...DESTINATARIO_OK, phone: null },
    });
    expect(d.acao).toBe("pular");
    expect(d.motivo).toBe("Destinatário sem telefone.");
  });

  it("telefone em branco é o mesmo que não ter", () => {
    const d = decidirDisparoDoDestinatario({
      regime: "oficial",
      plano: PLANO_OK,
      destinatario: { ...DESTINATARIO_OK, phone: "   " },
    });
    expect(d.acao).toBe("pular");
  });

  it.each(["sent", "failed", "skipped", "delivered", "unconfirmed"])(
    "linha já em %s não é reprocessada — ninguém recebe duas vezes",
    (status) => {
      // ADR-0028 §5 e a user story 21: reprocessar um lote não pode mandar duas
      // vezes para a mesma pessoa. Não é só incômodo — a duplicata é COBRADA.
      const d = decidirDisparoDoDestinatario({
        regime: "oficial",
        plano: PLANO_OK,
        destinatario: { ...DESTINATARIO_OK, status },
      });
      expect(d.acao).toBe("pular");
    },
  );
});

describe("precedência — recusa de plano antes de pulo de linha", () => {
  it("plano pausado E linha sem telefone: recusa, e a linha NÃO é queimada", () => {
    // A ordem é dinheiro e é retomada. Uma linha `skipped` não volta nunca; uma
    // linha intocada volta no próximo tique. Marcar `skipped` por causa de um
    // plano pausado queimaria um destinatário por um problema que não é dele —
    // e, no dia em que o plano fosse retomado, ele não receberia.
    const d = decidirDisparoDoDestinatario({
      regime: "oficial",
      plano: { ...PLANO_OK, status: "paused" },
      destinatario: { ...DESTINATARIO_OK, phone: null },
    });
    expect(d.acao).toBe("recusar");
  });
});
