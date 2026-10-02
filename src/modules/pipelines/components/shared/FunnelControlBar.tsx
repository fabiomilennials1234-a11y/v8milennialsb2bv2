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
 * V5: a faixa deixou de ser uma tira com borda e virou o cabeçalho de página
 * do sistema — nome do funil como título (28 px), controles à direita e, logo
 * abaixo, a pílula escura de visões (Kanban · Lista · Timeline · Analytics).
 * A pílula volta a deixar a visão ativa à vista: escondida no menu "Views",
 * quem estava em Analytics não sabia por que o quadro tinha sumido.
 *
 * Os controles entram por **slot** em vez de prop-a-prop. Cada página de funil
 * já tem seu `KanbanFilterPanel`, seu `SavedViewsDropdown` e seus botões com
 * regras próprias; recebê-los prontos evita reescrever quatro contratos e
 * mantém esta faixa como layout, não como orquestrador.
 */

interface FunnelControlBarProps {
  /** Chave do funil aberto (`pipeline:<id>`) — ver `funnel-nav`. */
  funnelKey: string;
  funnelLabel: string;
  funnelColor?: string;
  /** Ícone do funil (`pipelines.icon`) enquanto a lista do seletor carrega. */
  funnelIcon?: string | null;
  /** Linha de apoio sob o nome do funil (ex.: a descrição do funil). */
  subtitle?: ReactNode;

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
  /**
   * Navegação entre as visões do funil (Kanban · Lista · Timeline · Analytics)
   * — a pílula escura do V5, logo abaixo do nome, como em todo `PageHeader`.
   */
  tabs?: ReactNode;

  /** Chips de filtro ativo. Renderizados abaixo, só quando existem. */
  chips?: ReactNode;
}

export const FunnelControlBar = memo(function FunnelControlBar({
  funnelKey,
  funnelLabel,
  funnelColor,
  funnelIcon,
  subtitle,
  search,
  onSearchChange,
  searchPlaceholder = "Buscar lead, empresa, telefone…",
  views,
  filters,
  actions,
  primaryAction,
  tabs,
  chips,
}: FunnelControlBarProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="funnel-control-bar">
      {/* Um bloco só (cabeçalho + pílula de visões): os chips seguem sendo o
          ÚNICO segundo filho, e só quando existem. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          {/* O nome do funil é o título da página — e a porta para os outros. */}
          <div className="min-w-0 max-w-full">
            <h1 className="min-w-0">
              <FunnelSwitcher
                currentKey={funnelKey}
                fallbackLabel={funnelLabel}
                fallbackColor={funnelColor}
                fallbackIcon={funnelIcon}
              />
            </h1>
            {subtitle && (
              <p className="mt-1 max-w-[60ch] truncate text-[13px] text-muted-foreground">{subtitle}</p>
            )}
          </div>

          {/* Empurra os controles pra direita — o nome do funil ancora à esquerda. */}
          <span className="ml-auto" />

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-[180px] flex-1 sm:w-[240px] sm:flex-none">
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
                  "h-9 rounded-full border-card-border pl-10 shadow-relevo",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
                )}
              />
            </div>

            {views}
            {filters}
            {actions}
            {primaryAction}
          </div>
        </div>

        {tabs && <div className="flex min-w-0 max-w-full">{tabs}</div>}
      </div>

      {chips}
    </div>
  );
});
