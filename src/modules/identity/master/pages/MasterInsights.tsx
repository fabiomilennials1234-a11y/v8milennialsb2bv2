import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, LineChart } from "lucide-react";
import { useMasterOrganizations } from "../hooks/useMasterOrganizations";
import { InsightsEmptyState } from "../components/insights/InsightsEmptyState";
import { InsightsHeader } from "../components/insights/InsightsHeader";
import { InsightsContent } from "../components/insights/InsightsContent";
import type { InsightsMode } from "../components/insights/InsightsModeTabs";
import type { Horizonte } from "../components/insights/lib/format";
import type { OrgOption } from "../components/insights/OrgInsightsCombobox";

/**
 * Insights — área MASTER-ONLY (azul) de unit economics por organização.
 * Rota top-level com chrome próprio (não o `MasterLayout` vermelho). O gate de
 * master vive no `<MasterRoute>` que envolve a rota em `App.tsx`.
 *
 * Orquestra os dois momentos (DESIGN §3): (A) vazio/seleção; (B) org selecionada
 * com abas Dados | Projeção. Possui org/horizonte/aba.
 */
export default function MasterInsights() {
  const navigate = useNavigate();
  const orgsQuery = useMasterOrganizations();

  const orgs: OrgOption[] = useMemo(
    () =>
      (orgsQuery.data ?? [])
        .map((o) => ({ id: o.id, name: o.name }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [orgsQuery.data],
  );

  const [orgId, setOrgId] = useState<string | null>(null);
  const [mode, setMode] = useState<InsightsMode>("dados");
  const [horizonte, setHorizonte] = useState<Horizonte>("mensal");

  const selectedOrg = orgs.find((o) => o.id === orgId) ?? null;

  return (
    <div className="relative min-h-screen bg-background">
      {/* Stage-light: radial azul estático atrás do header (DESIGN §3). */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[360px]"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, hsl(var(--insights) / 0.06), transparent 60%)",
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 px-8 lg:px-12">
        {/* Chrome próprio: voltar + wordmark Gestor */}
        <div className="flex items-center justify-between py-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-insights focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </button>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-insights">
            <LineChart className="h-4 w-4" />
            Gestor
          </span>
        </div>

        {!selectedOrg ? (
          <InsightsEmptyState
            orgs={orgs}
            onSelect={setOrgId}
            loading={orgsQuery.isLoading}
          />
        ) : (
          <>
            <InsightsHeader
              orgs={orgs}
              orgId={selectedOrg.id}
              orgName={selectedOrg.name}
              onSelectOrg={setOrgId}
              mode={mode}
              onModeChange={setMode}
              horizonte={horizonte}
              onHorizonteChange={setHorizonte}
            />
            <main className="py-8">
              <div className="mx-auto max-w-[1180px]">
                <InsightsContent
                  orgId={selectedOrg.id}
                  mode={mode}
                  setMode={setMode}
                  horizonte={horizonte}
                />
              </div>
            </main>
          </>
        )}
      </div>
    </div>
  );
}
