import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SavedViewsDropdown } from "@/modules/platform/components/saved-views/SavedViewsDropdown";
import {
  pipelineEntityType,
  type SavedViewEntityType,
} from "@/types/saved-views";

/**
 * O menu "Views" do funil — alternador de visão em cima, visualizações salvas
 * embaixo, num gatilho só.
 *
 * É a decisão 1 do protótipo `.specs/mockups/funis-redesign/`. O Modelo 1
 * enxugou a faixa pra seis controles e tirou dela o alternador
 * Kanban/Lista/Analytics; sem um lar, a visão **Lista** — a única que o mobile
 * tem — ficaria inalcançável no desktop. Trazê-la pra cá devolve a visão sem
 * gastar a fileira que o Modelo 1 acabou de economizar.
 *
 * O gatilho carrega o ícone da visão ativa, não um ícone fixo: escondido dentro
 * de um menu, o estado precisa aparecer por fora, senão quem está em Analytics
 * não sabe por que o board sumiu.
 *
 * ⚠️ Sem a pílula de visões (`withViewSwitcher` = true, o padrão), este menu
 * é o **único** caminho de volta do Analytics. A página não pode escondê-lo
 * por visão (o painel de Filtros, sim).
 *
 * V5: a página do funil passou a mostrar as visões numa pílula escura sob o
 * nome (`FunnelControlBar.tabs`) e liga `withViewSwitcher={false}` — o menu
 * fica só com as visualizações salvas. Duas portas para a mesma troca, uma
 * delas escondida, era o que o V5 tirou.
 */

export interface FunnelViewOption<T extends string> {
  value: T;
  icon: LucideIcon;
  label: string;
  /** Linha de apoio no item do menu. */
  hint?: string;
}

/**
 * De onde vêm as views salvas deste menu (SCRUM-634). Exatamente um dos dois:
 *
 * - `pipelineId` — caminho canônico: qualquer funil, sistema ou custom. O menu
 *   constrói o entity_type `pipeline:{uuid}` sozinho.
 * - `entityType` — escape legado das 3 páginas pré-unificação, que ainda
 *   passam o slug ("pipe_whatsapp"). Some junto com elas.
 */
type FunnelEntitySource =
  | { pipelineId: string; entityType?: never }
  | { pipelineId?: never; entityType: SavedViewEntityType };

type FunnelViewsMenuProps<
  TView extends string,
  TFilters extends Record<string, unknown>,
> = FunnelEntitySource & {
  viewMode: TView;
  onViewModeChange: (value: TView) => void;
  viewOptions: FunnelViewOption<TView>[];

  /** Repassados a `SavedViewsDropdown`. */
  currentFilters: TFilters;
  defaultFilters: TFilters;
  onApplyFilters: (filters: TFilters) => void;
  activeViewId: string | null;
  onActiveViewChange: (viewId: string | null) => void;
  /**
   * Mostra o bloco "Visão" no topo do popover (e o ícone da visão no gatilho).
   * `false` quando a página já expõe as visões em outro lugar (a pílula do V5).
   */
  withViewSwitcher?: boolean;
};

export function FunnelViewsMenu<
  TView extends string,
  TFilters extends Record<string, unknown>,
>({
  viewMode,
  onViewModeChange,
  viewOptions,
  pipelineId,
  entityType,
  withViewSwitcher = true,
  ...savedViewsProps
}: FunnelViewsMenuProps<TView, TFilters>) {
  const activeOption =
    viewOptions.find((o) => o.value === viewMode) ?? viewOptions[0];

  // O union garante exatamente um dos dois em compile-time; o `??` cobre o
  // runtime sem `!`.
  const resolvedEntityType: SavedViewEntityType =
    pipelineId != null ? pipelineEntityType(pipelineId) : entityType;

  if (!withViewSwitcher) {
    return <SavedViewsDropdown {...savedViewsProps} entityType={resolvedEntityType} />;
  }

  return (
    <SavedViewsDropdown
      {...savedViewsProps}
      entityType={resolvedEntityType}
      triggerIcon={activeOption?.icon}
      header={({ close }) => (
        <div className="p-1" role="group" aria-label="Visão do funil">
          <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
            Visão
          </p>
          {viewOptions.map(({ value, icon: Icon, label, hint }) => {
            const active = value === viewMode;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  // Trocar de visão é uma ação concluída — fechar evita que o
                  // popover tape justamente o board que acabou de mudar.
                  if (!active) onViewModeChange(value);
                  close();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors",
                  "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                  active
                    ? "bg-primary-soft text-primary-soft-foreground"
                    : "hover:bg-muted/60",
                )}
              >
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    active ? "text-primary-soft-foreground" : "text-muted-foreground",
                  )}
                />
                <span className="flex-1 truncate text-sm">{label}</span>
                {hint && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    />
  );
}
