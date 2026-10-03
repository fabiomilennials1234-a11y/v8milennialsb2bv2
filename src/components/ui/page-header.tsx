import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, MoreHorizontal, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho de página do V5.
 *
 * Título grande e apertado à esquerda, ações à direita, navegação da página
 * (abas em pílula escura) logo abaixo — ou ao lado do título em telas largas.
 * Não decide o que a página mostra: só a forma do topo, para que as ~25 telas
 * deixem de desenhar cada uma o seu.
 *
 * `back` liga o botão redondo de voltar. `true` volta no histórico; uma string
 * navega para aquela rota (telas de detalhe têm um "pai" certo, o histórico
 * pode ter vindo de qualquer lugar).
 *
 * `secondaryActions` são as ações de apoio (importar, exportar, histórico):
 * pílulas brancas a partir de `sm`, um menu `⋯` no celular — em pílula, três
 * ou quatro delas ocupavam duas linhas antes do conteúdo. `actions` fica para
 * o que é sempre visível (o primário em ouro, no máximo um `ink`).
 */
/**
 * Onde a pílula da página mora. No V5 a navegação da página sobe para o centro
 * da barra superior (`TopBar`), que publica o elemento-alvo aqui. Sem barra
 * (TV, rotas de tela cheia, testes) o contexto é `null` e a pílula fica logo
 * abaixo do título, como antes.
 */
const PageTabsSlotContext = React.createContext<HTMLElement | null>(null);
export const PageTabsSlotProvider = PageTabsSlotContext.Provider;

export interface PageHeaderAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Tinta do ícone (ex.: o envio da Carteira em ouro suave). */
  iconClassName?: string;
  /** No desktop vira botão só de ícone, com o rótulo no tooltip (atalhos: TV, Métricas). */
  iconOnly?: boolean;
}

interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Rótulo pequeno acima do título (ex.: nome do funil, "Pitstop"). */
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  secondaryActions?: PageHeaderAction[];
  /** Rótulo acessível do menu `⋯` do celular. */
  secondaryActionsLabel?: string;
  /** Navegação da página — normalmente `<TabsList variant="pill">`. */
  tabs?: React.ReactNode;
  back?: boolean | string;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  secondaryActions,
  secondaryActionsLabel = "Mais ações",
  tabs,
  back,
  className,
  ...props
}: PageHeaderProps) {
  const hasSecondary = !!secondaryActions?.length;
  const tabsSlot = React.useContext(PageTabsSlotContext);
  const navigate = useNavigate();
  const onBack = React.useCallback(() => {
    if (typeof back === "string") navigate(back);
    else navigate(-1);
  }, [back, navigate]);

  return (
    <header className={cn("flex flex-col gap-4", className)} {...props}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {back && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-card-border bg-card text-foreground shadow-relevo transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        {/* Piso de largura: sem ele, duas ações na mesma linha espremem o
            título até sumir; com ele, as ações quebram para a linha de baixo. */}
        <div className="min-w-[min(100%,14rem)] flex-1">
          {eyebrow && (
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">{eyebrow}</p>
          )}
          <h1 className="truncate text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.035em] text-foreground max-sm:text-[1.375rem]">
            {title}
          </h1>
          {subtitle && <p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {(actions || hasSecondary) && (
          <div className="flex flex-wrap items-center gap-2">
            {hasSecondary && (
              <>
                {secondaryActions!.map(({ label, icon: Icon, onSelect, disabled, iconClassName, iconOnly }) =>
                  iconOnly && Icon ? (
                    <Tooltip key={label}>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={onSelect}
                          disabled={disabled}
                          aria-label={label}
                          className="max-sm:hidden"
                        >
                          <Icon className={iconClassName} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button key={label} variant="outline" onClick={onSelect} disabled={disabled} className="max-sm:hidden">
                      {Icon && <Icon className={iconClassName} />}
                      {label}
                    </Button>
                  ),
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" className="sm:hidden" aria-label={secondaryActionsLabel}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {secondaryActions!.map(({ label, icon: Icon, onSelect, disabled, iconClassName }) => (
                      <DropdownMenuItem key={label} onSelect={onSelect} disabled={disabled}>
                        {Icon && <Icon className={iconClassName} />}
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {actions}
          </div>
        )}
      </div>
      {/* `[&>*]:min-w-0`: a raiz de `<Tabs>` nasce com `min-width:auto` e, no
          slot estreito do celular, a pílula vazava da tela em vez de rolar —
          a aba ativa ficava cortada e o esmaecimento nunca disparava. */}
      {tabs &&
        (tabsSlot ? (
          createPortal(<div className="flex min-w-0 max-w-full [&>*]:min-w-0">{tabs}</div>, tabsSlot)
        ) : (
          <div className="flex min-w-0 max-w-full [&>*]:min-w-0">{tabs}</div>
        ))}
    </header>
  );
}
