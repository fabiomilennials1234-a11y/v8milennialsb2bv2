import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  LEAD_SORT_COLUMNS,
  toggleLeadSort,
  type LeadListSort,
  type LeadSortKey,
} from "../../lib/lead-list-sort";

/**
 * A ordenação da lista de Leads no celular.
 *
 * ── POR QUE ISTO NÃO EXISTIA ──────────────────────────────────────────────
 * No desktop, quem ordena é o cabeçalho da tabela (`LeadListHeader`): clicar
 * em `Nome` ou `Data de criação` troca a ordem. Abaixo de 768px não há
 * cabeçalho — a lista vira cartões —, então a ordenação simplesmente não
 * existia. Quem trabalha no telefone ficava com a ordem padrão e nada mais,
 * numa base onde a maior org tem 3.929 leads.
 *
 * ── MESMO CATÁLOGO, MESMA REGRA ───────────────────────────────────────────
 * Este controle NÃO define semântica própria: lê `LEAD_SORT_COLUMNS` e chama
 * `toggleLeadSort`, a mesma fonte única do cabeçalho (ADR-0024 decisão 2).
 * Duas consequências que valem escrever:
 *
 *   - só aparecem as colunas que ordenam NO SERVIDOR. As outras quatro do
 *     cabeçalho (Contatos, Tags, Negócios, Dono) não têm ordem server-side, e
 *     ordená-las no cliente reordenaria as 50 linhas da página fingindo ser
 *     ordenação — a mentira que a decisão 2 tirou dos cards do topo;
 *   - clicar na coluna já ativa INVERTE; clicar na outra adota a direção
 *     natural dela (data começa da mais recente, nome começa de A). Isso é do
 *     `toggleLeadSort`, não daqui, então celular e desktop não podem divergir.
 *
 * A ordem escolhida é a mesma `usePersistedState("leads-sort")` do desktop:
 * ordenar no telefone e depois abrir no computador mantém o que foi escolhido.
 */
export function LeadMobileSortBar({
  sort,
  onSortChange,
}: {
  sort: LeadListSort;
  onSortChange: (proxima: LeadListSort) => void;
}) {
  const rotulos: Record<LeadSortKey, string> = {
    name: "Nome",
    created_at: "Data de criação",
  };

  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
      role="group"
      aria-label="Ordenar a lista"
      data-testid="lead-mobile-sort"
    >
      <span className="shrink-0 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/70">
        Ordenar
      </span>

      {(Object.keys(LEAD_SORT_COLUMNS) as LeadSortKey[]).map((chave) => {
        const ativa = sort.key === chave;
        const Seta = ativa && sort.direction === "asc" ? ArrowUp : ArrowDown;

        return (
          <button
            key={chave}
            type="button"
            // `aria-pressed` e não `aria-selected`: são botões de alternância,
            // não itens de uma lista de opções — leitor de tela anuncia o
            // estado sem precisar de papel de listbox.
            aria-pressed={ativa}
            data-testid={`lead-mobile-sort-${chave}`}
            onClick={() => onSortChange(toggleLeadSort(sort, chave))}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ativa
                ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                : "border-border text-muted-foreground active:bg-muted/60",
            )}
          >
            {rotulos[chave]}
            {/* A seta só existe na coluna ativa: seta em coluna inativa sugere
                que ela já ordena, que é o oposto do que está acontecendo. */}
            {ativa && <Seta className="size-3" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
