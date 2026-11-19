import { cn } from "@/lib/utils";

/**
 * Um "osso" de skeleton: o bloco que ocupa o lugar de um texto, avatar ou
 * número enquanto o dado não chega. A forma da tela é montada com eles — a
 * mesma grade, os mesmos tamanhos — para que o dado entre sem pular layout.
 *
 * Dois tons, os dois só com token V5:
 *   `cartao` — sobre cartão/bancada (claro: muted→card; escuro: secondary→muted)
 *   `tinta`  — sobre painel de tinta (tinta-2 → tinta-3)
 * O brilho que atravessa some com `prefers-reduced-motion`.
 */
export function Osso({
  className,
  tom = "cartao",
}: {
  className?: string;
  tom?: "cartao" | "tinta";
}) {
  return (
    <span
      aria-hidden
      data-osso
      className={cn(
        "relative block overflow-hidden rounded-md",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer after:bg-gradient-to-r after:from-transparent after:to-transparent",
        "motion-reduce:after:hidden",
        tom === "tinta"
          ? "bg-tinta-2 after:via-tinta-3"
          : "bg-muted after:via-card dark:bg-secondary dark:after:via-muted",
        className,
      )}
    />
  );
}
