import { selectVisiblePipelines } from "@/modules/pipelines";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  LayoutTemplate, Search, Loader2, Zap, Clock, MessageSquare, Star,
  GitBranch, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCreateWorkflow } from "@/modules/workflows/hooks/useWorkflows";
import { FUNIL_A_TEMPLATES, FUNIL_B_TEMPLATES } from "@/contracts/workflows/funnel-templates";
import { toast } from "sonner";
import type { WorkflowTemplate } from "@/contracts/workflows/workflow-template";
import { useAllPipelineStages, useFunisDaOrg } from "@/modules/pipelines";
import { canonicalizeTemplateFunnelRefs } from "@/modules/workflows/lib/canonicalizeTemplateFunnelRefs";
import { countDiscontinuedSteps } from "@/modules/workflows/lib/discontinued-steps";
import { IconChip } from "@/components/ui/bento";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TRIGGER_LABELS } from "@/types/workflow";
import { notifyError } from "@/shared/errors";

// Reexportado por compatibilidade: a interface agora é contrato compartilhado
// (`@/contracts/workflows/workflow-template`), porque o provisionamento de org
// em `identity` também consome os templates. Importe de lá em código novo.
export type { WorkflowTemplate };

const CATEGORY_LABELS: Record<string, string> = {
  general: "Geral",
  engagement: "Engajamento",
  follow_up: "Follow-up",
  post_sale: "Pós-venda",
  qualification: "Qualificação",
  funil_a: "Funil A",
  funil_b: "Funil B",
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  general: Zap,
  engagement: MessageSquare,
  follow_up: Clock,
  post_sale: Star,
  qualification: TrendingUp,
  funil_a: GitBranch,
  funil_b: GitBranch,
};

/**
 * Built-in templates — used as fallback when DB has none.
 */
const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "tpl-welcome",
    name: "Sequência de boas-vindas",
    description: "Envia mensagem de boas-vindas quando o lead é criado",
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
    name: "Follow-up após 3 dias sem resposta",
    description: "Envia lembrete quando lead não responde em 3 dias",
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
    name: "NPS pós-venda",
    description: "Envia pesquisa de satisfação 7 dias após venda",
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
    description: "Reativa leads inativos há mais de 30 dias",
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

/**
 * Templates de workflow — forma V5 (mockup "Automações"): uma fileira compacta
 * "Comece por um template" com os cinco primeiros e "Ver todos", que abre a
 * galeria completa (categorias, busca, grupos por funil) num `Sheet`. Antes a
 * galeria inteira ocupava o topo da página.
 *
 * O `Sheet` é controlado por quem monta (o botão "Templates" do cabeçalho
 * abre a mesma galeria).
 */
export function WorkflowTemplates({
  galleryOpen,
  onGalleryOpenChange,
}: {
  galleryOpen?: boolean;
  onGalleryOpenChange?: (open: boolean) => void;
} = {}) {
  const [ownGalleryOpen, setOwnGalleryOpen] = useState(false);
  const isGalleryOpen = galleryOpen ?? ownGalleryOpen;
  const setGalleryOpen = onGalleryOpenChange ?? setOwnGalleryOpen;
  const { data: templates = [], isLoading } = useWorkflowTemplates();
  const { data: pipelines, isLoading: pipelinesLoading } = useFunisDaOrg();
  const { data: stages = [], isLoading: stagesLoading } = useAllPipelineStages();
  const createWorkflow = useCreateWorkflow();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null);

  // Template que carrega passo de score/rating (descontinuados — CTO, 02/10)
  // não é mais oferecido: criar a partir dele recriaria o que saiu do produto.
  const offered = templates.filter((t) => countDiscontinuedSteps(t.definition) === 0);
  const categories = ["all", ...new Set(offered.map((t) => t.category))];

  const filtered = offered.filter((t) => {
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
      const definition = canonicalizeTemplateFunnelRefs(template.definition, selectVisiblePipelines(pipelines), stages);
      const triggerNode = (definition as any).nodes?.find(
        (n: any) => n.type === "trigger",
      );
      const triggerType = triggerNode?.data?.triggerType ?? "lead_created";
      const triggerConfig = triggerNode?.data?.config ?? {};

      const result = await createWorkflow.mutateAsync({
        name: `${template.name} (cópia)`,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        definition: definition as any,
        is_active: false,
      });
      toast.success("Workflow criado a partir do template");
      navigate(`/automacoes/${result.id}`);
    } catch (err: any) {
      notifyError(err, { fallback: "Não foi possível criar workflow." });
    }
  }

  const matchesSearch = (t: WorkflowTemplate) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      t.tags?.some((tag) => tag.toLowerCase().includes(q)) ||
      false
    );
  };

  const renderCard = (tpl: WorkflowTemplate) => {
    const CatIcon = CATEGORY_ICONS[tpl.category] ?? Zap;
    return (
      <button
        key={tpl.id}
        type="button"
        className="group flex flex-col gap-2 rounded-2xl border border-border/70 bg-card p-4 text-left transition-[border-color,background-color,box-shadow] hover:border-primary/40 hover:bg-primary-soft/30 hover:shadow-relevo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setSelected(tpl)}
      >
        <div className="flex items-center gap-2.5">
          <IconChip icon={CatIcon} tone="gold" />
          <span className="min-w-0 text-sm font-bold leading-tight tracking-tight">{tpl.name}</span>
        </div>
        {tpl.description && (
          <span className="line-clamp-2 text-xs text-muted-foreground">{tpl.description}</span>
        )}
        {(tpl.tags ?? []).length > 0 && (
          <span className="mt-auto flex flex-wrap gap-1.5">
            {(tpl.tags ?? []).slice(0, 3).map((tag) => (
              <Badge key={tag} variant="soft" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </span>
        )}
      </button>
    );
  };

  // Seções de templates por funil — base de sistema, sempre visível (toda org).
  const funnelSections = [
    { key: "funil_a", label: "Funil A", items: FUNIL_A_TEMPLATES.filter((t) => matchesSearch(t) && countDiscontinuedSteps(t.definition) === 0) },
    { key: "funil_b", label: "Funil B", items: FUNIL_B_TEMPLATES.filter((t) => matchesSearch(t) && countDiscontinuedSteps(t.definition) === 0) },
  ];

  const strip = offered.slice(0, 5);

  const triggerOf = (tpl: WorkflowTemplate) => {
    const trigger = (tpl.definition as { nodes?: Array<{ type?: string; data?: { triggerType?: string } }> })?.nodes?.find(
      (n) => n.type === "trigger",
    );
    const t = trigger?.data?.triggerType;
    return t ? TRIGGER_LABELS[t as keyof typeof TRIGGER_LABELS] ?? t : null;
  };

  const renderCompact = (tpl: WorkflowTemplate) => {
    const CatIcon = CATEGORY_ICONS[tpl.category] ?? Zap;
    const nodeCount = (tpl.definition as { nodes?: unknown[] })?.nodes?.length ?? 0;
    const trigger = triggerOf(tpl);
    return (
      <button
        key={tpl.id}
        type="button"
        onClick={() => setSelected(tpl)}
        className="group flex min-w-[220px] flex-1 flex-col gap-2 rounded-[18px] border border-border bg-card p-4 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-foreground/20 hover:shadow-relevo-alto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-0"
      >
        <span className="flex items-center justify-between gap-2">
          <IconChip icon={CatIcon} tone="gold" />
          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
            {nodeCount} nós
          </span>
        </span>
        <span className="mt-1 line-clamp-1 text-[15px] font-bold tracking-tight text-foreground">{tpl.name}</span>
        {tpl.description && (
          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{tpl.description}</span>
        )}
        {trigger && (
          <span className="mt-auto flex items-center gap-1.5 pt-1 text-[11px] font-medium text-muted-foreground">
            <Zap className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{trigger}</span>
          </span>
        )}
      </button>
    );
  };

  return (
    <>
    <section className="space-y-4 rounded-card border border-card-border bg-card p-5 shadow-relevo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold tracking-tight">Comece por um template</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Fluxos prontos — você ajusta mensagens, prazos e responsáveis depois.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setGalleryOpen(true)}>
          Ver todos
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : strip.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Nenhum template disponível agora.</p>
      ) : (
        <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 scrollbar-hide sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-5">
          {strip.map(renderCompact)}
        </div>
      )}
    </section>

    {/* Galeria completa */}
    <Sheet open={isGalleryOpen} onOpenChange={setGalleryOpen}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
        <SheetHeader className="space-y-3 border-b border-border/60 px-6 pb-4 pt-6">
          <SheetTitle className="flex items-center gap-2.5">
            <IconChip icon={LayoutTemplate} />
            Templates
          </SheetTitle>
          <SheetDescription>Escolha um ponto de partida. O workflow nasce desativado para você revisar.</SheetDescription>
        <div className="relative w-64 max-w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar template..."
            aria-label="Buscar template"
            className="h-9 rounded-full pl-9"
          />
        </div>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
      {/* Category tabs */}
      <Tabs value={category} onValueChange={setCategory}>
        <TabsList variant="segmented" className="max-w-full overflow-x-auto scrollbar-hide">
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
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-sunken py-12 text-center">
              <LayoutTemplate className="mb-3 h-7 w-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Nenhum template encontrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map(renderCard)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Seções por funil — templates-base de sistema, abaixo dos templates gerais */}
      {funnelSections.map((section) =>
        section.items.length === 0 ? null : (
          <div key={section.key} className="space-y-3 border-t border-border/60 pt-4">
            <h3 className="flex items-center gap-2 text-sm font-bold tracking-tight">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              {section.label}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground/70">
                {section.items.length}
              </span>
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {section.items.map(renderCard)}
            </div>
          </div>
        ),
      )}

        </div>
      </SheetContent>
    </Sheet>

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
                  <Badge key={tag} variant="soft" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">
                  {((selected.definition as any)?.nodes?.length ?? 0)} nós
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
              disabled={createWorkflow.isPending || pipelinesLoading || stagesLoading}
            >
              {(createWorkflow.isPending || pipelinesLoading || stagesLoading) && (
                <Loader2 className="animate-spin" />
              )}
              Usar template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
