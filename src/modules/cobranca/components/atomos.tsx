import { forwardRef, useEffect, useState, type CSSProperties } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { atrasoDe, type TomDoAtraso } from "../lib/atraso";
import { iniciais } from "../lib/formato";
import { lerValor } from "../lib/planilha";

/**
 * Cor do selo de atraso — só tokens semânticos do V5 (nada de paleta nova): a
 * escala sobe do azul de informação ao vermelho sólido, que fica reservado
 * para o que passou de 60 dias.
 */
const TOM: Record<TomDoAtraso, string> = {
  neutro: "bg-muted text-muted-foreground",
  atencao: "bg-insights/10 text-insights",
  aviso: "bg-warning/15 text-warning-strong",
  alerta: "bg-destructive/10 text-destructive",
  critico: "bg-destructive text-destructive-foreground",
};

export function AtrasoSelo({
  vencimento,
  className,
}: {
  vencimento: string | null | undefined;
  className?: string;
}) {
  const atraso = atrasoDe(vencimento);
  if (!atraso) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-full px-2.5 text-[11.5px] font-bold tabular-nums",
        TOM[atraso.tom],
        className,
      )}
      title={vencimento ? `Vencimento mais antigo: ${vencimento.split("-").reverse().join("/")}` : undefined}
    >
      {atraso.rotulo}
    </span>
  );
}

export function EtapaPill({ nome, cor, className }: { nome: string; cor?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[24px] max-w-full items-center gap-1.5 rounded-full border border-border bg-sunken px-2.5 text-[11.5px] font-semibold",
        className,
      )}
    >
      <span aria-hidden className="size-[7px] shrink-0 rounded-full" style={{ background: cor ?? "currentColor" }} />
      <span className="truncate">{nome}</span>
    </span>
  );
}

/** Mesma cor para o mesmo nome, sempre (o hue sai do nome). */
function hueDe(nome: string): number {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return h;
}

export function IniciaisAvatar({
  nome,
  tamanho = "md",
  className,
}: {
  nome: string;
  tamanho?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={{ "--cob-hue": hueDe(nome || "?") } as CSSProperties}
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold",
        tamanho === "xs" && "size-[22px] text-[9px]",
        tamanho === "sm" && "size-[26px] text-[10px]",
        tamanho === "md" && "size-8 text-[11.5px]",
        tamanho === "lg" && "size-12 text-base",
        "bg-[hsl(var(--cob-hue)_70%_92%)] text-[hsl(var(--cob-hue)_55%_34%)]",
        "dark:bg-[hsl(var(--cob-hue)_40%_20%)] dark:text-[hsl(var(--cob-hue)_70%_74%)]",
        className,
      )}
    >
      {iniciais(nome || "?")}
    </span>
  );
}

/**
 * Valor em reais digitado como brasileiro escreve ("1.234,56"). Guarda o
 * número; mostra o que a pessoa digitou até ela sair do campo.
 */
export const CampoDeReais = forwardRef<
  HTMLInputElement,
  {
    id?: string;
    valor: number | null;
    onValor: (v: number | null) => void;
    placeholder?: string;
    className?: string;
    "aria-label"?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }
>(function CampoDeReais({ valor, onValor, className, ...props }, ref) {
  const formatar = (v: number | null) =>
    v == null ? "" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [texto, setTexto] = useState(formatar(valor));
  const [focado, setFocado] = useState(false);
  useEffect(() => {
    if (!focado) setTexto(formatar(valor));
  }, [valor, focado]);
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        R$
      </span>
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className="pl-9 tabular-nums"
        value={texto}
        onFocus={() => setFocado(true)}
        onBlur={() => {
          setFocado(false);
          setTexto(formatar(valor));
        }}
        onChange={(e) => {
          setTexto(e.target.value);
          onValor(lerValor(e.target.value));
        }}
        {...props}
      />
    </div>
  );
});
