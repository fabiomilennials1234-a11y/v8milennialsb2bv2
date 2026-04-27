import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import type { CopilotNodeData } from "@/types/workflow";

interface CopilotPanelProps {
  data: CopilotNodeData;
  onUpdate: (updates: Partial<CopilotNodeData>) => void;
}

export function CopilotPanel({ data, onUpdate }: CopilotPanelProps) {
  const { organizationId } = useOrganization();

  const { data: agents, isLoading } = useQuery({
    queryKey: ["copilot-agents-list", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("copilot_agents")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Transferir para agente SDR"
        />
      </div>

      <div className="space-y-2">
        <Label>Agente Copilot</Label>
        {isLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Carregando agentes...</span>
          </div>
        ) : (
          <Select
            value={data.agentId || ""}
            onValueChange={(v) => {
              const agent = agents?.find((a) => a.id === v);
              onUpdate({
                agentId: v,
                agentName: agent?.name || "",
              });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o agente" />
            </SelectTrigger>
            <SelectContent>
              {agents?.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="p-3 rounded-lg bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800">
        <p className="text-xs text-cyan-700 dark:text-cyan-300">
          Ao atingir este nó, o workflow transfere o controle da conversa para o agente
          selecionado e encerra a execução.
        </p>
      </div>
    </div>
  );
}
