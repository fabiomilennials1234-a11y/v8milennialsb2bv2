/**
 * A LEI DA DIVISÃO — quem é lead e quem é cliente na lista.
 *
 * Regra, decidida pelo CTO em 2026-09-04: **cliente é quem comprou**. A âncora
 * é `sale_events`, o caderno canônico de receita (ADR-0017), materializado em
 * `leads.primeira_venda_at` pela migration `20270932000000`.
 *
 * Por que essa âncora, e não outra — medido na Chiquê no mesmo dia, sobre 4.194
 * leads vivos:
 *
 * | definição                        | leads |
 * |----------------------------------|-------|
 * | venda em `sale_events`           | 36    |
 * | `deals.outcome = 'won'`          | 14    |
 * | pedido no ERP (`order_count`)    | 14    |
 * | card parado em etapa ganha       | 0     |
 *
 * A união das três primeiras é exatamente 36: `sale_events` CONTÉM as outras, e
 * ainda pega 22 leads que venderam sem ninguém marcar o negócio como ganho. O
 * card em etapa ganha não serve de prova — 119 leads no produto venderam e o
 * card já saiu da etapa (ver `lead-relacao-situacao.ts`).
 *
 * ⚠️ NÃO CONFUNDIR COM `leads.classificacao`. Aquela coluna responde "está
 * cadastrado no ERP?" e discorda desta abertamente: na Café Jurerê, dos 5.442
 * leads com `classificacao = 'cliente'`, **exatamente 1** tem venda. Por
 * decisão do CTO as duas convivem, e é por isso que na tela aquela se chama
 * "Cadastro no ERP" — para parar de disputar a palavra "cliente".
 */

export const RELACAO_ABAS = ["leads", "clientes", "todos"] as const;

export type RelacaoAba = (typeof RELACAO_ABAS)[number];

export const RELACAO_ABA_CONFIG: Record<
  RelacaoAba,
  { label: string; descricao: string; vazio: string }
> = {
  leads: {
    label: "Leads",
    descricao: "Ainda não compraram",
    vazio:
      "Nenhum lead em aberto com estes filtros. Quem já comprou está na aba Clientes.",
  },
  clientes: {
    label: "Clientes",
    descricao: "Já compraram ao menos uma vez",
    vazio:
      "Ninguém comprou ainda com estes filtros. A primeira venda registrada move o lead para cá sozinha.",
  },
  todos: {
    label: "Todos",
    descricao: "A lista inteira, sem separar",
    vazio: "Nenhum registro com estes filtros.",
  },
};

export function isRelacaoAba(valor: unknown): valor is RelacaoAba {
  return (
    typeof valor === "string" && (RELACAO_ABAS as readonly string[]).includes(valor)
  );
}

/**
 * A aba efetiva a partir do que veio do estado persistido.
 *
 * Visão salva anterior a esta lei não traz a chave, e o padrão nesse caso é
 * `"todos"` — e não `"leads"`. Quem salvou uma visão antes das abas existirem
 * salvou uma lista SEM recorte; abri-la com gente escondida mudaria o que ela
 * guardou, que é a única coisa que uma visão salva promete.
 */
export function abaEfetiva(valor: unknown): RelacaoAba {
  return isRelacaoAba(valor) ? valor : "todos";
}
