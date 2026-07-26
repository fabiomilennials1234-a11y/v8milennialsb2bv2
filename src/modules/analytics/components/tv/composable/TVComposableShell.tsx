import { TVComposableWall } from "./TVComposableWall";
import { useDashboardPages } from "@/modules/analytics/hooks/useComposableDashboard";
import { useDashboardSnapshot } from "@/modules/analytics/hooks/useDashboardSnapshot";

/**
 * Casca da TV montável: superfície de tema, chrome mínimo e a parede.
 *
 * `data-surface="tv"` é o escopo de tema (§2.1) — os MESMOS nomes de token do app
 * redeclarados com valores calibrados para parede vista a 3m. Não é paleta paralela.
 */
export function TVComposableShell() {
  const { data: pages } = useDashboardPages("tv");
  const pageId = pages?.[0]?.id ?? null;
  // Mesma queryKey da parede → React Query deduplica: continua UMA chamada por
  // atualização, não uma por consumidor.
  const snapshot = useDashboardSnapshot({ pageId, period: "month" });

  const disabled = snapshot.data?.disabled === true;

  return (
    <div
      data-surface="tv"
      className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <header className="flex shrink-0 items-baseline justify-between px-6 pt-5">
        <h1 className="font-semibold" style={{ fontSize: "var(--tv-label)", letterSpacing: "0.08em" }}>
          {(pages?.[0]?.title ?? "").toUpperCase()}
        </h1>
        {/* §5.4 — UM indicador por painel, não por widget. O badge "AO VIVO"
            estático foi cortado: um badge que sempre mente é pior que nenhum. */}
        <FreshnessIndicator
          failureCount={snapshot.failureCount}
          dataUpdatedAt={snapshot.dataUpdatedAt}
        />
      </header>

      <div className="min-h-0 flex-1">
        {disabled ? null : <TVComposableWall period="month" />}
      </div>
    </div>
  );
}

function FreshnessIndicator({
  failureCount,
  dataUpdatedAt,
}: {
  failureCount: number;
  dataUpdatedAt: number;
}) {
  // Saudável: sem ponto pulsante. Após 3 falhas consecutivas: hora do último dado.
  const stale = failureCount >= 3;
  const text = stale
    ? `dados de ${new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : "atualizado agora";

  return (
    <span
      className={stale ? "text-warning" : "text-muted-foreground"}
      style={{ fontSize: "var(--tv-meta)" }}
    >
      {text}
    </span>
  );
}
