import * as React from "react";
import { ArrowLeft, MoreHorizontal, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
export interface PageHeaderAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Tinta do ícone (ex.: o envio da Carteira em ouro suave). */
  iconClassName?: string;
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
                {secondaryActions!.map(({ label, icon: Icon, onSelect, disabled, iconClassName }) => (
                  <Button key={label} variant="outline" onClick={onSelect} disabled={disabled} className="max-sm:hidden">
                    {Icon && <Icon className={iconClassName} />}
                    {label}
                  </Button>
                ))}
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
      {tabs && <div className="flex min-w-0 max-w-full">{tabs}</div>}
    </header>
  );
}
