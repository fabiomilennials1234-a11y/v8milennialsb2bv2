import { memo, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { FunnelChipStrip } from "./FunnelChipStrip";

/**
 * Topo da página do funil — V5 na composição do mockup.
 *
 * De cima para baixo:
 *   1. o cabeçalho do sistema (`PageHeader`): título FIXO "Funis", apoio,
 *      configurações + a ação de ouro da família, e a pílula de visões
 *      (Kanban · Lista · Timeline · Analytics · Todos os funis);
 *   2. a faixa de funis em chips (o aberto em tinta) + o resumo em tinta à
 *      direita — o seletor que morava no título virou clique à vista;
 *   3. a barra de controle: busca, os atalhos de filtro da página (Hoje,
 *      Amanhã, Semana, Atrasadas), e à direita Filtros · Visões · ⋯.
 *
 * Os chips de filtro ATIVO seguem abaixo, e só quando existem — são estado,
 * não controle: quem não filtrou não paga a fileira.
 *
 * Os controles continuam entrando por **slot**: cada página traz o seu painel
 * de filtros, o seu menu de visões e os seus botões; esta faixa é layout, não
 * orquestrador.
 */

interface FunnelControlBarProps {
  /** Chave do funil aberto (`pipeline:<id>`) — ver `funnel-nav`. */
  funnelKey: string;
  funnelLabel: string;
  funnelColor?: string;
  /** Ícone do funil (`pipelines.icon`). Mantido no contrato; a faixa usa a cor. */
  funnelIcon?: string | null;
  /** Linha de apoio sob o título (ex.: a descrição do funil). */
  subtitle?: ReactNode;

  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;

  /** Visualizações salvas. */
  views?: ReactNode;
  /** Painel de filtros (o botão, não os chips). */
  filters?: ReactNode;
  /** Atalhos de filtro à vista (Hoje, Amanhã…) — logo depois da busca. */
  quickFilters?: ReactNode;
  /** Menu ⋯ e o que mais a página tiver na barra de controle. */
  actions?: ReactNode;
  /** Ações do cabeçalho antes do primário (ex.: configurações do funil). */
  headerActions?: ReactNode;
  /** Ação primária, no cabeçalho (ex.: "Novo negócio"). */
  primaryAction?: ReactNode;
  /** Navegação entre as visões — a pílula escura do `PageHeader`. */
  tabs?: ReactNode;
  /** Resumo em tinta à direita da faixa de funis (contagens do funil). */
  summary?: ReactNode;

  /** Chips de filtro ativo. Renderizados abaixo, só quando existem. */
  chips?: ReactNode;
}

export const FunnelControlBar = memo(function FunnelControlBar({
  funnelKey,
  subtitle,
  search,
  onSearchChange,
  searchPlaceholder = "Buscar lead, empresa, telefone…",
  views,
  filters,
  quickFilters,
  actions,
  headerActions,
  primaryAction,
  tabs,
  summary,
  chips,
}: FunnelControlBarProps) {
  const hasHeaderActions = !!headerActions || !!primaryAction;

  return (
    <div className="flex flex-col gap-3" data-testid="funnel-control-bar">
      {/* Um bloco só (cabeçalho + faixa + controles): os chips seguem sendo o
          ÚNICO segundo filho, e só quando existem. */}
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Funis"
          subtitle={subtitle ?? "Arraste o negócio entre etapas."}
          actions={
            hasHeaderActions ? (
              <>
                {headerActions}
                {primaryAction}
              </>
            ) : undefined
          }
          tabs={tabs}
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <FunnelChipStrip currentKey={funnelKey} className="flex-1" />
          {summary && <div className="shrink-0">{summary}</div>}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:w-[260px]">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Buscar no funil"
              data-testid="funnel-search"
              className={cn(
                "h-[38px] rounded-full pl-10 shadow-relevo",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
              )}
            />
          </div>

          {/* No celular a linha vira faixa que rola; no desktop o invólucro
              some (`sm:contents`) e os itens voltam a ser da linha. */}
          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide sm:contents">
            {quickFilters}
            <span className="hidden flex-1 sm:block" />
            {filters}
            {views}
            {actions}
          </div>
        </div>
      </div>

      {chips}
    </div>
  );
});
