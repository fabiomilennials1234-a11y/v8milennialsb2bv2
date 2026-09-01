/**
 * Como se LÊ uma nota que o produto escreveu em `lead_history`.
 *
 * ── O FORMATO NÃO É CONVENÇÃO, É CONSTRUÇÃO ───────────────────────────────
 * `useLogLeadAction.ts` monta a linha como `` `${userName}: ${description}` ``
 * antes de gravar, e o bloco de notas do painel do chat
 * (`ContextPanelTabInfo.tsx`) faz o mesmo no INSERT dele. Ou seja: o nome de
 * quem escreveu não está numa coluna, está grudado no começo do texto — e a
 * única forma de mostrar autor e corpo separados é desfazer essa junção na
 * leitura.
 *
 * Medido em produção em 01/09/2026, sobre as **1.250** linhas
 * `action = 'note_added'`: zero sem `:`, zero com corpo vazio depois do corte,
 * zero com prefixo acima de 40 caracteres, zero com `description` nula. O
 * prefixo casa com um `team_members.name` da mesma org em 1.181 (94,5%); os que
 * não casam ainda são nomes de gente que saiu do time. Não há caso conhecido em
 * que o corte invente um autor.
 *
 * ⚠️ Corta no PRIMEIRO `:` de propósito. Nota de vendedor tem dois-pontos no
 * meio o tempo todo ("Bruno: orçamento: 3 mil"), e cortar no último jogaria
 * metade do texto para o campo de autor.
 *
 * Esta função existe para haver UM leitor deste formato. Ela é pura de
 * propósito — nada de React, nada de Supabase — porque quem a usa está em dois
 * bounded contexts (`leads` e `communication`).
 */

export interface NotaDoHistorico {
  /** Quem escreveu, quando o texto traz o prefixo. `null` quando não traz. */
  autor: string | null;
  /** O que a pessoa escreveu, já sem o prefixo de autor. */
  corpo: string;
}

/**
 * Separa autor e corpo de uma `lead_history.description` de nota.
 *
 * Sem `:` — ou com o corpo vazio depois dele — devolve o texto INTEIRO como
 * corpo e `autor: null`. Nunca devolve corpo vazio quando havia texto: perder o
 * que a pessoa escreveu é pior do que exibir a linha sem autor.
 */
export function lerNotaDoHistorico(description: string | null | undefined): NotaDoHistorico {
  const bruto = (description ?? "").trim();
  if (bruto === "") return { autor: null, corpo: "" };

  const corte = bruto.indexOf(":");
  if (corte === -1) return { autor: null, corpo: bruto };

  const autor = bruto.slice(0, corte).trim();
  const corpo = bruto.slice(corte + 1).trim();

  // Prefixo sem nada depois (ou sem nada antes) não é "autor: texto" — é texto
  // que por acaso tem dois-pontos. Devolve inteiro em vez de mutilar.
  if (autor === "" || corpo === "") return { autor: null, corpo: bruto };

  return { autor, corpo };
}
