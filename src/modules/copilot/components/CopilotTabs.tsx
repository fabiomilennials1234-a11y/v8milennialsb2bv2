/**
 * Navegação de página do Copilot — Agentes · Editor · Métricas LLM.
 *
 * São rotas (`/copilot`, `/copilot/:id/editar`, `/copilot/metricas`). Editor
 * aponta para o agente em foco e fica desligado sem um; o gate de assinatura
 * continua sendo o da própria rota do editor.
 */
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CopilotTab = "agentes" | "editor" | "metricas";

export function CopilotTabs({
  active,
  agentId,
  count,
}: {
  active: CopilotTab;
  agentId: string | null;
  count?: number;
}) {
  const navigate = useNavigate();
  const go = (tab: string) => {
    if (tab === active) return;
    if (tab === "agentes") navigate("/copilot");
    else if (tab === "metricas") navigate("/copilot/metricas");
    else if (agentId) navigate(`/copilot/${agentId}/editar`);
  };
  return (
    <Tabs value={active} onValueChange={go}>
      <TabsList variant="pill" aria-label="Seções do Copilot">
        <TabsTrigger value="agentes">
          Agentes
          {count != null && <span className="text-[11px] font-extrabold tabular-nums opacity-70">{count}</span>}
        </TabsTrigger>
        <TabsTrigger value="editor" disabled={!agentId}>
          Editor
        </TabsTrigger>
        <TabsTrigger value="metricas">Métricas LLM</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
