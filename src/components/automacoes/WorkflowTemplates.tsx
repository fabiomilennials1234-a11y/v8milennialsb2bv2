import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  LayoutTemplate, Search, Loader2, Zap, Clock, MessageSquare, Star,
  GitBranch, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCreateWorkflow } from "@/hooks/useWorkflows";
import { toast } from "sonner";

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string;
  definition: Record<string, unknown>;
  tags: string[];
  popularity: number;
  is_system: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "Geral",
  engagement: "Engajamento",
  follow_up: "Follow-up",
  post_sale: "Pos-venda",
  qualification: "Qualificacao",
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  general: Zap,
  engagement: MessageSquare,
  follow_up: Clock,
  post_sale: Star,
  qualification: TrendingUp,
};

/**
 * Built-in templates — used as fallback when DB has none.
 */
const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "tpl-welcome",
    name: "Sequencia de boas-vindas",
    description: "Envia mensagem de boas-vindas quando lead entra no pipe WhatsApp",
    category: "engagement",
    tags: ["whatsapp", "boas-vindas"],
    popularity: 100,
    is_system: true,
    definition: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 400, y: 50 }, data: { type: "trigger", triggerType: "lead_created", config: {}, label: "Lead criado" } },
        { id: "delay-1", type: "delay", position: { x: 400, y: 200 }, data: { type: "delay", label: "Espera 5min", amount: 5, unit: "minutes" } },
        { id: "action-1", type: "action", position: { x: 400, y: 350 }, data: { type: "action", actionType: "send_whatsapp", label: "Boas-vindas", config: { message: "Ola {{lead_name}}! Bem-vindo." } } },
        { id: "end-1", type: "end", position: { x: 400, y: 500 }, data: { type: "end", label: "Fim" } },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "delay-1" },
        { id: "e2", source: "delay-1", target: "action-1" },
        { id: "e3", source: "action-1", target: "end-1" },
      ],
    },
  },
  {
    id: "tpl-followup-3d",
    name: "Follow-up apos 3 dias sem resposta",
    description: "Envia lembrete quando lead nao responde em 3 dias",
    category: "follow_up",
    tags: ["follow-up", "reengajamento"],
    popularity: 90,
    is_system: true,
    definition: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 400, y: 50 }, data: { type: "trigger", triggerType: "lead_no_reply", config: { timeout_hours: 72 }, label: "Sem resposta 3d" } },
        { id: "action-1", type: "action", position: { x: 400, y: 200 }, data: { type: "action", actionType: "send_whatsapp", label: "Lembrete", config: { message: "Oi {{lead_name}}, percebi que nao recebemos retorno. Posso ajudar?" } } },
        { id: "wait-1", type: "wait_response", position: { x: 400, y: 350 }, data: { type: "wait_response", label: "Esperar resposta", timeoutHours: 48, timeoutMinutes: 0, channel: "any" } },
        { id: "end-1", type: "end", position: { x: 400, y: 500 }, data: { type: "end", label: "Fim" } },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "action-1" },
        { id: "e2", source: "action-1", target: "wait-1" },
        { id: "e3", source: "wait-1", target: "end-1" },
      ],
    },
  },
  {
    id: "tpl-nps",
    name: "NPS pos-venda",
    description: "Envia pesquisa de satisfacao 7 dias apos venda",
    category: "post_sale",
    tags: ["nps", "pos-venda", "feedback"],
    popularity: 80,
    is_system: true,
    definition: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 400, y: 50 }, data: { type: "trigger", triggerType: "stage_changed", config: { pipe_type: "propostas", stages: ["vendido"] }, label: "Vendido" } },
        { id: "delay-1", type: "delay", position: { x: 400, y: 200 }, data: { type: "delay", label: "Espera 7 dias", amount: 7, unit: "days" } },
        { id: "action-1", type: "action", position: { x: 400, y: 350 }, data: { type: "action", actionType: "send_whatsapp", label: "NPS", config: { message: "Oi {{lead_name}}! De 0 a 10, quanto voce recomendaria nossos servicos?" } } },
        { id: "end-1", type: "end", position: { x: 400, y: 500 }, data: { type: "end", label: "Fim" } },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "delay-1" },
        { id: "e2", source: "delay-1", target: "action-1" },
        { id: "e3", source: "action-1", target: "end-1" },
      ],
    },
  },
  {
    id: "tpl-reengagement",
    name: "Reengajamento 30 dias",
    description: "Reativa leads inativos ha mais de 30 dias",
    category: "engagement",
    tags: ["reengajamento", "inativo"],
    popularity: 70,
    is_system: true,
    definition: {
      nodes: [
        { id: "trigger-1", type: "trigger", position: { x: 400, y: 50 }, data: { type: "trigger", triggerType: "cron", config: { cron_expression: "0 10 * * 1", description: "Segunda 10h" }, label: "Semanal" } },
        { id: "condition-1", type: "condition", position: { x: 400, y: 200 }, data: { type: "condition", label: "Inativo >30d", field: "last_message_days", operator: "greater_than", value: "30", conditionMode: "field" } },
        { id: "action-1", type: "action", position: { x: 400, y: 350 }, data: { type: "action", actionType: "send_whatsapp", label: "Reativacao", config: { message: "Oi {{lead_name}}, faz tempo! Temos novidades. Quer saber mais?" } } },
        { id: "end-1", type: "end", position: { x: 400, y: 500 }, data: { type: "end", label: "Fim" } },
      ],
      edges: [
        { id: "e1", source: "trigger-1", target: "condition-1" },
        { id: "e2", source: "condition-1", target: "action-1", sourceHandle: "yes" },
        { id: "e3", source: "action-1", target: "end-1" },
      ],
    },
  },
];

function useWorkflowTemplates() {
  return useQuery<WorkflowTemplate[]>({
    queryKey: ["workflow-templates"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("workflow_templates")
        .select("*")
        .order("popularity", { ascending: false });

      if (error) {
        console.warn("workflow_templates query failed, using builtins:", error.message);
        return BUILTIN_TEMPLATES;
      }

      const dbTemplates = (data ?? []) as WorkflowTemplate[];
      return dbTemplates.length > 0 ? dbTemplates : BUILTIN_TEMPLATES;
    },
    staleTime: 5 * 60_000,
  });
}

export function WorkflowTemplates() {
  const { data: templates = [], isLoading } = useWorkflowTemplates();
  const createWorkflow = useCreateWorkflow();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null);

  const categories = ["all", ...new Set(templates.map((t) => t.category))];

  const filtered = templates.filter((t) => {
    if (category !== "all" && t.category !== category) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return true;
  });

  async function handleUseTemplate(template: WorkflowTemplate) {
    try {
      const triggerNode = (template.definition as any).nodes?.find(
        (n: any) => n.type === "trigger",
      );
      const triggerType = triggerNode?.data?.triggerType ?? "lead_created";
      const triggerConfig = triggerNode?.data?.config ?? {};

      const result = await createWorkflow.mutateAsync({
        name: `${template.name} (copia)`,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        definition: template.definition as any,
        is_active: false,
      });
      toast.success("Workflow criado a partir do template");
      navigate(`/automacoes/${result.id}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao criar workflow");
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutTemplate className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Templates</h3>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar template..."
            className="pl-9 h-8"
          />
        </div>
      </div>

      {/* Category tabs */}
      <Tabs value={category} onValueChange={setCategory}>
        <TabsList>
          <TabsTrigger value="all">Todos</TabsTrigger>
          {categories
            .filter((c) => c !== "all")
            .map((c) => (
              <TabsTrigger key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </TabsTrigger>
            ))}
        </TabsList>

        <TabsContent value={category} className="mt-4">
          {filtered.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <LayoutTemplate className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Nenhum template encontrado</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((tpl) => {
                const CatIcon = CATEGORY_ICONS[tpl.category] ?? Zap;
                return (
                  <Card
                    key={tpl.id}
                    className="hover:shadow-md transition-shadow cursor-pointer group"
                    onClick={() => setSelected(tpl)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                          <CatIcon className="h-4 w-4" />
                        </div>
                        <CardTitle className="text-sm">{tpl.name}</CardTitle>
                      </div>
                      {tpl.description && (
                        <CardDescription className="text-xs line-clamp-2">
                          {tpl.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex flex-wrap gap-1.5">
                        {(tpl.tags ?? []).slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview + Use dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>{selected?.description}</DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(selected.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">
                  {((selected.definition as any)?.nodes?.length ?? 0)} nos
                </span>{" "}
                |{" "}
                <span>{CATEGORY_LABELS[selected.category] ?? selected.category}</span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => selected && handleUseTemplate(selected)}
              disabled={createWorkflow.isPending}
            >
              {createWorkflow.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Usar template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
