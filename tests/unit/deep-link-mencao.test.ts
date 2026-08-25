import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A notificação de menção volta a levar a algum lugar.
 *
 * ── Por que este arquivo existe ────────────────────────────────────────────
 * O defeito era invisível a TODO portão do repo, e essa é a lição:
 *
 *   · o `AlertsDropdown` não pedia a coluna `link` no `select()`. O PostgREST
 *     devolve só o que se projeta, então `n.link` chegava `undefined` e o
 *     `|| "/pipe-whatsapp"` recuava SEMPRE. Clicar numa menção abria o funil;
 *   · o compilador SABIA — `.tsc-baseline.json` carregava o
 *     `AlertsDropdown.tsx|TS2339|Property 'link' does not exist` desta exata
 *     linha. Mas o Vite/SWC não typecheca, e o ratchet só reprova erro NOVO:
 *     um erro real ficou congelado no teto e embarcou;
 *   · nenhum teste montava o dropdown, e o único leitor do `?comment=`
 *     (`ActivityFeed`) vive em árvore que ninguém monta — logo nem um teste de
 *     integração da ponta acusaria.
 *
 * Um erro que o compilador já apontou e que mesmo assim chegou em produção não
 * volta a ser pego pelo compilador. Por isso a asserção aqui é sobre o TEXTO da
 * consulta: é o único lugar onde o fato "a coluna foi pedida" é observável sem
 * um banco.
 *
 * ── Como este teste foi provado ───────────────────────────────────────────
 * Por MUTAÇÃO, nos dois sentidos: com o `link` removido do `select()` o 1º caso
 * reprova; com os quatro nomes de parâmetro reduzidos a `"lead"` o 2º reprova.
 * Um guarda que só foi visto passar não foi medido.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

describe("deep-link da notificação de menção", () => {
  it("o dropdown de alertas PEDE a coluna `link` das notificações", () => {
    const fonte = ler("src/modules/platform/components/notifications/AlertsDropdown.tsx");

    // A consulta de `notifications` — a única do arquivo que projeta colunas
    // dessa tabela. Recortada pelo `.from("notifications")` para não casar com
    // o `.update({ read_at })` que marca a notificação como lida.
    const consulta = fonte.slice(fonte.indexOf('.from("notifications")'));
    const select = consulta.slice(consulta.indexOf(".select("), consulta.indexOf(")", consulta.indexOf(".select(")));

    expect(select).toContain("link");

    // O fallback continua existindo — ele é legítimo para notificação sem link
    // (as antigas não têm). O que não pode é ele ser o ÚNICO caminho.
    expect(fonte).toContain('n.link || "/pipe-whatsapp"');
  });

  it("a página de Leads aceita os QUATRO nomes de parâmetro que chegam nela", () => {
    const fonte = ler("src/modules/leads/pages/Leads.tsx");

    // Quatro vocabulários produzem o mesmo gesto no produto. Ler só um faz os
    // outros três abrirem /leads sem abrir ficha nenhuma, em silêncio:
    //   `lead`    — os 11 produtores que já funcionavam
    //   `leadId`  — o gatilho de menção e o OraculoBriefing
    //   `id`      — o popover da Agenda e as abas de lead
    //   `detail`  — os itens recentes do Cmd+K
    for (const nome of ["lead", "leadId", "id", "detail"]) {
      expect(fonte).toContain(`searchParams.get("${nome}")`);
    }

    // E o `?comment=` precisa sair da URL para alguém: é ele que diz QUAL
    // comentário destacar quando o card abre.
    expect(fonte).toContain('searchParams.get("comment")');
  });

  it("o comentário destacado chega até o histórico da ficha", () => {
    // A cadeia inteira, arquivo a arquivo. Se alguém cortar um elo, o
    // `?comment=` volta a não fazer nada — e isso não daria erro em lugar
    // nenhum, porque cada peça isolada continua válida.
    const elos: Array<[string, string]> = [
      // quem lê a URL e abre o card
      ["src/modules/leads/pages/Leads.tsx", "openLead(deepLinkLeadId, null, deepLinkCommentId)"],
      // o contexto que carrega o id (e NÃO um useSearchParams lá embaixo —
      // `cards-nunca-empilham.test.tsx` monta o painel sem Router)
      ["src/modules/leads/components/lead-detail/hooks/useLeadSheet.tsx", "comentarioDestacadoId"],
      ["src/modules/leads/components/lead-card/LeadCardPanel.tsx", "comentarioDestacadoId"],
      ["src/modules/leads/components/lead-card/LeadCardContainer.tsx", "comentarioDestacadoId"],
      ["src/modules/leads/components/lead-card/LeadCard.tsx", "comentarioDestacadoId"],
      // e a âncora, que é onde a rolagem pousa
      ["src/modules/leads/components/lead-card/LeadCardHistory.tsx", "data-comentario-id"],
    ];

    for (const [arquivo, marca] of elos) {
      expect(ler(arquivo), `${arquivo} perdeu o elo \`${marca}\``).toContain(marca);
    }
  });

  it("a âncora usa o id do COMENTÁRIO, não o do evento", () => {
    // O evento de histórico é `comentario:<uuid>` (useLeadCardData.ts:279) e
    // quem chega pela notificação traz o uuid NU. Ancorar em `e.id` faria a
    // busca nunca casar — e falharia em silêncio, que é o modo de falha caro
    // aqui: a tela abre certa e só não rola.
    const fonte = ler("src/modules/leads/components/lead-card/LeadCardHistory.tsx");
    expect(fonte).toContain("data-comentario-id={e.comentario?.id}");
    expect(fonte).not.toContain("data-comentario-id={e.id}");
  });
});
