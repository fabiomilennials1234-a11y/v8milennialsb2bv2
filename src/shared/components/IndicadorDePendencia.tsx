import { useRotaPendente } from "@/core/route-prefetch";

/**
 * Fio de ouro no topo da tela enquanto o chunk da próxima rota desce.
 *
 * O BrowserRouter do RR 7 navega em transição: a tela antiga fica parada, sem
 * fallback, até a nova poder renderizar. Sem sinal, o clique parece não ter
 * pegado. O fio só aparece depois de 100 ms (régua: invisível abaixo disso) e
 * fica parado — sem varredura — com `prefers-reduced-motion`.
 */
export function IndicadorDePendencia() {
  const pendente = useRotaPendente();
  if (!pendente) return null;
  return (
    <div
      role="status"
      aria-label="Abrindo a tela"
      data-testid="indicador-de-pendencia"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden bg-primary/25 animate-fade-in motion-reduce:animate-none motion-reduce:bg-primary"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-full -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-primary to-transparent shadow-brilho-ouro motion-reduce:hidden"
      />
    </div>
  );
}
