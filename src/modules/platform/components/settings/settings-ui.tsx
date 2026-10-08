import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Peças de composição das abas de Configurações (V5, onda "mais perto do
 * mockup"). Só forma: nada aqui busca dado nem decide regra.
 */

/**
 * Onde a ação primária da aba aparece. No mockup ela mora no cabeçalho da
 * página ("Nova Tag", "Nova Instância", "Gerar chave"), mas quem sabe abrir o
 * diálogo é o painel da aba. A página publica um elemento-alvo e o painel
 * entrega o botão para lá — o estado do diálogo continua no painel.
 *
 * Sem alvo (painel aberto dentro do modal de uma integração, ou num teste),
 * o botão fica onde o painel o desenhou.
 */
const SlotDeAcoesContext = createContext<HTMLElement | null>(null);
export const SlotDeAcoesProvider = SlotDeAcoesContext.Provider;

export function AcaoDoCabecalho({ children, fallbackClassName }: { children: ReactNode; fallbackClassName?: string }) {
  const slot = useContext(SlotDeAcoesContext);
  if (slot) return createPortal(children, slot);
  return <div className={cn("flex flex-wrap items-center gap-2", fallbackClassName)}>{children}</div>;
}

/** Rótulo micro em maiúsculas — cabeçalho de grupo e de coluna. */
export function RotuloMicro({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground", className)}>{children}</p>
  );
}

/** Pílula de estado numa linha de tinta: verde/vermelho/neutro, e invertida quando a linha está selecionada. */
export function PilulaDeEstado({
  tom,
  selecionada,
  children,
}: {
  tom: "bom" | "ruim" | "aviso" | "neutro";
  selecionada?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
        selecionada
          ? "bg-tinta text-tinta-foreground"
          : tom === "bom"
            ? "bg-success/15 text-success-strong"
            : tom === "ruim"
              ? "bg-destructive/15 text-destructive-strong"
              : tom === "aviso"
                ? "bg-warning/15 text-warning-strong"
                : "bg-white/10 text-tinta-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tom === "bom" ? "bg-success" : tom === "ruim" ? "bg-destructive" : tom === "aviso" ? "bg-warning" : "bg-current opacity-60",
        )}
      />
      {children}
    </span>
  );
}

/**
 * Linha de ajuste do V5: rótulo e ajuda à esquerda, o controle (~340 px) à
 * direita. No celular empilha.
 */
export function LinhaDeAjuste({
  rotulo,
  ajuda,
  htmlFor,
  children,
  className,
}: {
  rotulo: ReactNode;
  ajuda?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 border-t border-border py-4 first:border-t-0 first:pt-1 last:pb-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,340px)] sm:items-center sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-bold tracking-tight">
            {rotulo}
          </label>
        ) : (
          <p className="text-sm font-bold tracking-tight">{rotulo}</p>
        )}
        {ajuda && <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{ajuda}</p>}
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

/** Cartão de seção do V5: título + descrição e as linhas embaixo. */
export function CartaoDeAjustes({
  titulo,
  descricao,
  acoes,
  children,
  className,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-card border border-card-border bg-card p-5 text-card-foreground shadow-relevo sm:p-6", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight">{titulo}</h3>
          {descricao && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{descricao}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {/* Embrulho próprio: o `first:` das linhas conta a partir daqui. */}
      <div>{children}</div>
    </div>
  );
}
