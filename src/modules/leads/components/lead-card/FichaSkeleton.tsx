import { Osso } from "@/shared/espera";
import { cn } from "@/lib/utils";

/**
 * A ficha em osso — a forma real enquanto a pessoa (ou o negócio) não chega:
 *   `lead`    avatar + nome + empresa, fileira de ações, abas e campos
 *   `negocio` título, trilha de etapas, valor e abas do negócio
 * Mesmas margens da ficha real, para o dado entrar sem pular layout.
 */
export function FichaSkeleton({
  variante = "lead",
  className,
}: {
  variante?: "lead" | "negocio";
  className?: string;
}) {
  if (variante === "negocio") {
    return (
      <div aria-hidden data-testid="ficha-skeleton-negocio" className={cn("flex flex-col gap-4 py-2", className)}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Osso className="h-5 w-48 rounded-lg" />
            <Osso className="h-3 w-28" />
          </div>
          <Osso className="h-8 w-24 rounded-full" />
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Osso key={i} className="h-1.5 flex-1 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Osso className="h-16 rounded-card" />
          <Osso className="h-16 rounded-card" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Osso key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <div className="flex flex-col gap-2.5">
          <Osso className="h-3 w-full" />
          <Osso className="h-3 w-5/6" />
          <Osso className="h-3 w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div aria-hidden data-testid="ficha-skeleton-lead" className={cn("flex flex-col gap-5 p-5", className)}>
      <div className="flex items-center gap-3.5">
        <Osso className="h-12 w-12 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Osso className="h-4 w-44 rounded-lg" />
          <Osso className="h-3 w-28" />
        </div>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Osso key={i} className="h-9 w-9 rounded-xl" />
        ))}
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Osso key={i} className="h-7 w-24 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Osso className="h-2.5 w-16" />
            <Osso className="h-3.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
