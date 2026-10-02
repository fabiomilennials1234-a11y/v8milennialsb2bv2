/**
 * Navegação de página de Automações — Workflows · Editor · Execuções.
 *
 * São rotas (`/automacoes`, `/automacoes/:id`, `/automacoes/:id/execucoes`);
 * Editor e Execuções apontam para o workflow em foco e ficam desligados sem
 * um. A pílula só troca de rota — a guarda de alteração não salva do editor
 * continua sendo a do próprio editor.
 */
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type AutomacoesTab = "workflows" | "editor" | "execucoes";

export function AutomacoesTabs({
  active,
  workflowId,
  count,
}: {
  active: AutomacoesTab;
  workflowId: string | null;
  count?: number;
}) {
  const navigate = useNavigate();
  const go = (tab: string) => {
    if (tab === active) return;
    if (tab === "workflows") navigate("/automacoes");
    else if (workflowId) navigate(tab === "editor" ? `/automacoes/${workflowId}` : `/automacoes/${workflowId}/execucoes`);
  };
  return (
    <Tabs value={active} onValueChange={go}>
      <TabsList variant="pill" aria-label="Seções de Automações">
        <TabsTrigger value="workflows">
          Workflows
          {count != null && (
            <span className="text-[11px] font-extrabold tabular-nums opacity-70">{count}</span>
          )}
        </TabsTrigger>
        <TabsTrigger value="editor" disabled={!workflowId}>
          Editor
        </TabsTrigger>
        <TabsTrigger value="execucoes" disabled={!workflowId}>
          Execuções
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
