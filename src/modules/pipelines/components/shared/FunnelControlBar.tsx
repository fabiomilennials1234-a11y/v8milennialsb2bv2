import { memo, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FunnelSwitcher } from "./FunnelSwitcher";

/**
 * Faixa única de controles do funil — o "Modelo 1" do protótipo
 * `.specs/mockups/funis-redesign/`.
 *
 * O cabeçalho antigo empilhava **cinco fileiras** antes do board aparecer:
 * título + seis botões, seletor de período, busca + views + filtros, chips, e o
 * indicador de período. Em 1366px isso comia quase metade da altura útil — o
 * board, que é o trabalho, começava embaixo da dobra.
 *
 * Aqui tudo cabe em uma linha, e os chips seguem logo abaixo porque são estado
 * ativo, não controle: quem não filtrou não paga a fileira.
 *
 * Os controles entram por **slot** em vez de prop-a-prop. Cada página de funil
 * já tem seu `KanbanFilterPanel`, seu `SavedViewsDropdown` e seus botões com
 * regras próprias; recebê-los prontos evita reescrever quatro contratos e
 * mantém esta faixa como layout, não como orquestrador.
 */

interface FunnelControlBarProps {
  /** Chave do funil aberto (`sys:whatsapp`, `custom:<id>`) — ver `funnel-nav`. */
  funnelKey: string;
  funnelLabel: string;
  funnelColor?: string;

  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;

  /** Alternador de visão + visualizações salvas. */
  views?: ReactNode;
  /** Painel de filtros (o botão, não os chips). */
  filters?: ReactNode;
  /** Período, configurações, disparo — o que a página tiver. */
  actions?: ReactNode;
  /** Ação primária, à direita de tudo (ex.: "Novo negócio"). */
  primaryAction?: ReactNode;

  /** Chips de filtro ativo. Renderizados abaixo, só quando existem. */
  chips?: ReactNode;
}

export const FunnelControlBar = memo(function FunnelControlBar({
  funnelKey,
  funnelLabel,
  funnelColor,
  search,
  onSearchChange,
  searchPlaceholder = "Buscar lead, empresa, telefone…",
  views,
  filters,
  actions,
  primaryAction,
  chips,
}: FunnelControlBarProps) {
  return (
    <div className="flex flex-col gap-2" data-testid="funnel-control-bar">
      <div
        className={cn(
          "flex flex-wrap items-center gap-2",
          "rounded-xl border border-border/50 bg-card/40 px-2 py-1.5",
        )}
      >
        <FunnelSwitcher
          currentKey={funnelKey}
          fallbackLabel={funnelLabel}
          fallbackColor={funnelColor}
        />

        {/* Empurra os controles pra direita — o nome do funil ancora à esquerda. */}
        <span className="ml-auto" />

        <div className="relative w-full min-w-[180px] max-w-xs sm:w-auto sm:flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Buscar no funil"
            data-testid="funnel-search"
            className="h-9 pl-9"
          />
        </div>

        {views}
        {filters}
        {actions}
        {primaryAction}
      </div>

      {chips}
    </div>
  );
});
