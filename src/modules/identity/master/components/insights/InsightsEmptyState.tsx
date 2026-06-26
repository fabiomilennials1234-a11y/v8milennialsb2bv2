import { OrgInsightsCombobox, type OrgOption } from "./OrgInsightsCombobox";

interface InsightsEmptyStateProps {
  orgs: OrgOption[];
  onSelect: (orgId: string) => void;
  loading?: boolean;
}

/**
 * Estado vazio — "Selecione uma organização" (DESIGN §4). Centro vertical,
 * eyebrow azul, headline editorial, combobox hero, fantasma da Curva J ao fundo.
 */
export function InsightsEmptyState({ orgs, onSelect, loading }: InsightsEmptyStateProps) {
  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
      {/* Fantasma da Curva J ao fundo */}
      <svg
        className="pointer-events-none absolute inset-0 m-auto h-[60%] w-[80%] opacity-[0.045]"
        viewBox="0 0 800 400"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <path
          d="M0,120 C120,160 180,300 320,300 C460,300 520,120 800,20"
          fill="none"
          stroke="hsl(var(--insights))"
          strokeWidth={6}
          strokeLinecap="round"
        />
      </svg>

      <div className="cmd-rise relative z-10 flex flex-col items-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-insights">
          Insights
        </p>
        <h1 className="mt-3 font-display text-3xl tracking-[-0.02em] text-foreground md:text-[32px]">
          Unit economics por organização
        </h1>
        <p className="mt-3 max-w-md text-[15px] text-muted-foreground">
          Selecione uma organização para apresentar CAC, payback e projeção.
        </p>
      </div>

      <div
        className="cmd-rise relative z-10 mt-8"
        style={{ animationDelay: "80ms" }}
      >
        <OrgInsightsCombobox
          orgs={orgs}
          value={null}
          onSelect={onSelect}
          variant="hero"
          loading={loading}
        />
      </div>
    </div>
  );
}
