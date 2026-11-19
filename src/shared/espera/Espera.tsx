import type * as React from "react";
import { cn } from "@/lib/utils";
import { useFaseEspera } from "./regua";

export interface EsperaProps {
  /** `isPending && !data` — nunca `isFetching` (refetch não é espera). */
  carregando: boolean;
  /** Skeleton com a forma real da tela (monte com `<Osso>`). */
  forma: React.ReactNode;
  /** Texto fixo do que está acontecendo, em voz de vendedor. Nunca dado do usuário. */
  frase: string;
  /** Nome acessível da área em espera (padrão: a frase). */
  rotulo?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * A régua aplicada a uma área da tela:
 *   < 100 ms   a forma ocupa o espaço com opacidade 0 (layout reservado, nada pisca)
 *   ≥ 100 ms   a forma aparece (skeleton)
 *   ≥ 1 s      a frase entra numa região `aria-live="polite"`
 *   ao terminar, o skeleton visível cumpre 300 ms antes de dar lugar ao dado.
 *
 * A região viva existe desde o primeiro quadro — leitor de tela só anuncia
 * texto que ENTRA numa região já montada.
 *
 * Acessibilidade: a área é um `role="group"` ocupado (`aria-busy`) — `aria-label`
 * em div sem papel não é lido. O nome do grupo é o `rotulo`; sem ele o grupo
 * fica sem nome, porque usar a frase como nome faria o leitor dizê-la duas
 * vezes (nome do grupo + anúncio da região viva). Quem anuncia é só a região.
 * A frase quebra linha no celular: truncar cortaria o que ela diz.
 */
export function Espera({ carregando, forma, frase, rotulo, className, children }: EsperaProps) {
  const { fase, segurando } = useFaseEspera(carregando);

  if (!carregando && !segurando) return <>{children}</>;

  const visivel = fase !== "oculta";
  const comFrase = fase === "skeleton+frase";

  return (
    <div
      role="group"
      className={cn("relative", className)}
      aria-busy="true"
      aria-label={rotulo}
      data-espera={fase}
    >
      <div
        aria-hidden
        className={cn(
          "h-full transition-opacity duration-200 ease-standard motion-reduce:transition-none",
          visivel ? "opacity-100" : "opacity-0",
        )}
      >
        {forma}
      </div>
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4"
      >
        {comFrase && (
          <p className="flex max-w-full items-center gap-2.5 rounded-[18px] border border-card-border bg-card/95 px-3.5 py-1.5 text-[13px] font-medium text-muted-foreground shadow-relevo backdrop-blur-sm animate-fade-in motion-reduce:animate-none">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-novo-pulso motion-reduce:animate-none"
            />
            <span className="min-w-0 text-balance">{frase}</span>
          </p>
        )}
      </div>
    </div>
  );
}
