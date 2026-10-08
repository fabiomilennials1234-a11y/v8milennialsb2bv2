/**
 * Negócio encerrado no funil: borda, fundo e a faixa lateral do `.kanban-card`
 * (`--card-accent`) no tom do desfecho — verde no ganho, vermelho na perda.
 *
 * O fundo é uma CAMADA sobre `bg-card`, não uma troca dele: `bg-success/10`
 * sozinho deixaria o card translúcido sobre a coluna, e o card deixaria de
 * parecer um card. Compartilhado pelas duas densidades do card.
 *
 * Mora fora do `LeadCardCompact` porque arquivo de componente que exporta
 * constante quebra o fast refresh (`react-refresh/only-export-components`).
 *
 * Classes escritas por extenso, não montadas a partir do token: o Tailwind só
 * gera as classes que encontra literais no código.
 *
 * V5: o card ABERTO esconde a faixa lateral (`before:opacity-0` no card — a
 * faixa cinza era ruído num cartão branco de bento). `before:opacity-100`
 * aqui a devolve só para o desfecho, onde ela carrega informação. Por isso as
 * classes do desfecho vêm DEPOIS das do card no `cn()`.
 */
export const OUTCOME_CARD_CLASSES = {
  won: "border-success/50 bg-[linear-gradient(hsl(var(--success)/0.09),hsl(var(--success)/0.09))] [--card-accent:hsl(var(--success))] before:opacity-100",
  lost: "border-destructive/50 bg-[linear-gradient(hsl(var(--destructive)/0.09),hsl(var(--destructive)/0.09))] [--card-accent:hsl(var(--destructive))] before:opacity-100",
} as const;
