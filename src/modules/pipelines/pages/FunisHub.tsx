import { isPipelineVisible, selectVisiblePipelines } from "../lib/pipeline-navigation";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTemporaryFunnels } from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { useOrganization, useOrganizationSettings } from "@/modules/identity";
import { trackModuleVisit } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GitBranch,
  Plus,
  Kanban,
  ChevronDown,
  ArrowRight,
  LayoutGrid,
  List,
  BarChart3,
  Layers,
  Timer,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreateFunilOuCampanhaModal } from "@/modules/pipelines/components/funis/CreateFunilOuCampanhaModal";
import { FunnelActionsMenu } from "@/modules/pipelines/components/funis/FunnelActionsMenu";
import { usePipelines, type Pipeline } from "@/modules/pipelines/hooks/model/usePipelines";
import { funilIcon } from "../lib/funil-icons";
// Mesmo path map compat do seletor da faixa (morre no flip do redirect).
import { FUNNEL_FALLBACK_COLOR } from "../lib/funnel-nav";
import type { LucideIcon } from "lucide-react";

/**
 * Um funil na lista — com a cor e o ícone QUE O USUÁRIO ESCOLHEU.
 *
 * Cor/ícone vêm de `pipelines` (registro único, SCRUM-637): funil de sistema
 * persiste personalização como qualquer outro, e o hub reflete. Nome de
 * exibido vem de `pipelines.name`, a fonte canônica escolhida pelo usuário.
 */
interface FunilCard {
  key: string;
  name: string;
  path: string;
  color: string;
  icon: LucideIcon;
  /** Linha de apoio: prazo, meta, estado. Vazia quando não há o que dizer. */
  meta?: string;
  /** `pipelines.description` — o que o usuário escreveu sobre o funil. */
  description?: string | null;
  /** Funil com prazo: dias restantes e o bônus combinado (fatos do funil). */
  temporary?: { endsAt: string | null; daysLeft: number | null; teamGoal: number | null; bonus: number | null };
  /**
   * Linha canônica em `pipelines` — o que o menu de ações precisa para
   * renomear/excluir. Ausente só enquanto o registro não chegou: sem ela o
   * cartão continua listando e navegando, apenas sem menu.
   */
  pipeline?: Pipeline;
}

/** Valor da aba "Todos os funis" — a deste hub. */
const HUB_TAB = "todos-os-funis";
const HUB_VIEWS = [
  { value: "kanban", label: "Kanban", icon: LayoutGrid },
  { value: "list", label: "Lista", icon: List },
  { value: "analytics", label: "Analytics", icon: BarChart3 },
] as const;

/** Texto/ícone sobre o ladrilho preenchido: escuro em cor clara (ouro), branco no resto. */
function tileText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "text-white";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "text-black/80" : "text-white";
}

// ── Component ────────────────────────────────────────────────

export default function FunisHub() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { data: temporaryFunnels = [], isLoading: temporaryLoading } = useTemporaryFunnels();
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();

  // Registro único → cor/ícone reais de qualquer funil.
  const pipeById = new Map(pipelines.map((p) => [p.id, p] as const));
  const temporaryById = new Map(temporaryFunnels.map((p) => [p.id, p] as const));
  const { settings } = useOrganizationSettings();
  const [createOpen, setCreateOpen] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  useEffect(() => {
    trackModuleVisit("funis", organizationId);
  }, []);

  const isLoading = pipelinesLoading || temporaryLoading;

  // Encerrado não é categoria, é ESTADO — por isso segue recolhido no fim.
  const endedTemporary = temporaryFunnels.filter((f) => {
    const canonical = pipeById.get(f.id);
    return f.status === "ended" && (!canonical || isPipelineVisible(canonical));
  });

  const allFunnels: FunilCard[] = selectVisiblePipelines(pipelines)
    .filter((pipeline) => pipeline.is_active && !endedTemporary.some((p) => p.id === pipeline.id))
    .map((pipeline) => {
      const pipe = temporaryById.get(pipeline.id);
      const daysLeft = pipe?.ends_at
        ? Math.max(
            0,
            Math.ceil((new Date(pipe.ends_at!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          )
        : null;
      // Só o que é fato do funil. "Ativo" não entra: é o estado de todos os
      // outros da lista também, e dizê-lo só aqui recriaria a distinção.
      const partes = [
        pipe?.status === "paused" ? "Pausado" : null,
        pipe?.status === "draft" ? "Rascunho" : null,
      ].filter(Boolean);
      return {
        key: pipeline.id,
        name: pipeline.name,
        path: `/funil/${pipeline.slug}`,
        color: pipeline.color ?? FUNNEL_FALLBACK_COLOR,
        icon: funilIcon(pipeline.icon),
        meta: partes.length > 0 ? partes.join(" · ") : undefined,
        description: pipeline.description,
        temporary: pipe
          ? {
              endsAt: pipe.ends_at ?? null,
              daysLeft,
              teamGoal: pipe.team_goal ?? null,
              bonus: pipe.bonus_value ?? null,
            }
          : undefined,
        pipeline,
      };
    });

  // A pílula do funil vive aqui também (V5): "Todos os funis" é a 5ª aba. As
  // outras abrem o funil padrão da org já na visão escolhida.
  const defaultPath = settings?.default_pipeline_id
    ? `/funil/${settings.default_pipeline_id}`
    : allFunnels[0]?.path ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Funis"
        subtitle="Gerencie seus funis de vendas."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Criar
          </Button>
        }
        tabs={
          <Tabs
            value={HUB_TAB}
            onValueChange={(v) => {
              if (v !== HUB_TAB && defaultPath) navigate(defaultPath, { state: { view: v } });
            }}
          >
            <TabsList variant="pill" aria-label="Visão do funil">
              {HUB_VIEWS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value} disabled={!defaultPath}>
                  <Icon className="size-4" aria-hidden />
                  {label}
                </TabsTrigger>
              ))}
              <TabsTrigger value={HUB_TAB}>
                <Layers className="size-4" aria-hidden />
                Todos os funis
                {allFunnels.length > 0 && (
                  <span className="rounded-full bg-primary-foreground px-1.5 py-px text-[10px] font-extrabold tabular-nums text-primary">
                    {allFunnels.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {/* Carregando: o esqueleto já tem a forma da grade — o cabeçalho não
          espera dado nenhum, então ele não some enquanto a lista chega. */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Carregando funis">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[150px] rounded-card" />
          ))}
        </div>
      ) : (
        <>
          {/* Uma grade só (mockup V5): cartão por funil, e o último é a porta de
              criar. Só fatos do funil — sem contagem por cartão (seriam N
              consultas) e sem mini-barras (decisão do líder). */}
          {(allFunnels.length > 0 || endedTemporary.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {allFunnels.map((funil) => {
                const isDefault = settings?.default_pipeline_id === funil.key;
                const TileIcon = funil.temporary ? Timer : funil.icon;
                return (
                  /* O cartão hospeda o menu de ações, e botão dentro de botão é
                     HTML inválido (o menu nem abriria). A navegação é o miolo do
                     cartão; o menu é irmão dela. */
                  <div
                    key={funil.key}
                    className={cn(
                      "group relative flex min-h-[132px] flex-col rounded-card border border-card-border bg-card text-card-foreground shadow-relevo",
                      "transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-relevo-alto",
                      "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                    )}
                  >
                    <button
                      onClick={() => navigate(funil.path)}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col gap-3.5 rounded-card p-[18px] pr-14 text-left",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        {/* Ladrilho PREENCHIDO com a cor que o usuário escolheu. */}
                        <span
                          className={cn("grid size-[38px] shrink-0 place-items-center rounded-xl", tileText(funil.color))}
                          style={{ backgroundColor: funil.color }}
                        >
                          <TileIcon className="size-[18px]" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="line-clamp-2 break-words text-sm font-bold leading-snug tracking-[-0.01em]" title={funil.name}>
                              {funil.name}
                            </span>
                            {isDefault && (
                              <Badge variant="gold" className="shrink-0 px-2 py-0 text-[10px] uppercase tracking-[.04em]">
                                Padrão
                              </Badge>
                            )}
                          </span>
                          {(funil.temporary || funil.description) && (
                            <span className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                              {funil.temporary
                                ? funil.temporary.endsAt
                                  ? `Funil temporário · termina ${new Date(funil.temporary.endsAt).toLocaleDateString("pt-BR")}`
                                  : "Funil temporário"
                                : funil.description}
                            </span>
                          )}
                        </span>
                      </span>

                      {(funil.temporary || funil.meta) && (
                        <span className="flex flex-wrap items-center gap-1.5">
                          {funil.temporary?.daysLeft != null && (
                            <Badge variant="warning" className="px-2 py-0.5 text-[11px] tabular-nums">
                              {funil.temporary.daysLeft} {funil.temporary.daysLeft === 1 ? "dia" : "dias"}
                            </Badge>
                          )}
                          {funil.temporary?.teamGoal != null && (
                            <Badge variant="soft" className="px-2 py-0.5 text-[11px] tabular-nums">
                              Meta do time: {funil.temporary.teamGoal.toLocaleString("pt-BR")}
                            </Badge>
                          )}
                          {funil.temporary?.bonus != null && funil.temporary.bonus > 0 && (
                            <Badge variant="gold" className="px-2 py-0.5 text-[11px] tabular-nums">
                              Bônus {funil.temporary.bonus.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                            </Badge>
                          )}
                          {funil.meta && (
                            <Badge variant="soft" className="px-2 py-0.5 text-[11px]">
                              {funil.meta}
                            </Badge>
                          )}
                        </span>
                      )}
                      <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
                        Abrir quadro
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                    </button>
                    {funil.pipeline && (
                      <div className="absolute right-3 top-3">
                        <FunnelActionsMenu pipeline={funil.pipeline} displayName={funil.name} />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* A porta de criar é o último cartão (mockup), além do botão de ouro. */}
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className={cn(
                  "flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-card border-[1.5px] border-dashed border-border",
                  "text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:bg-card hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <Plus className="size-5" aria-hidden />
                Criar funil ou campanha
              </button>
            </div>
          )}

          {/* ── Encerrados (recolhidos) ─────────────────────────── */}
          {endedTemporary.length > 0 && (
            <section className="space-y-3 rounded-card border border-card-border bg-card p-4 shadow-relevo">
              <button
                onClick={() => setShowEnded(!showEnded)}
                aria-expanded={showEnded}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-1 py-1 text-[13px] font-semibold text-muted-foreground transition-colors",
                  "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform duration-200", showEnded && "rotate-180")}
                  aria-hidden
                />
                {endedTemporary.length} funil{endedTemporary.length > 1 ? "s" : ""}{" "}
                encerrado{endedTemporary.length > 1 ? "s" : ""}
              </button>
              {showEnded && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {endedTemporary.map((pipe) => {
                    const canonical = pipeById.get(pipe.id);
                    const displayName = canonical?.name ?? pipe.name;
                    return (
                    /* Encerrado é estado, não espécie: o funil segue sendo funil e
                       ganha o mesmo menu — é justamente aqui que "excluir" costuma
                       ser o que a pessoa quer. */
                    <div
                      key={pipe.id}
                      className="group flex items-center rounded-card border border-dashed border-border bg-card/60 text-card-foreground"
                    >
                      <button
                        onClick={() => navigate(`/funil/${canonical?.slug ?? pipe.slug}`)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-3.5 rounded-card p-[18px] text-left",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-muted text-muted-foreground">
                          <Kanban className="h-5 w-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-bold tracking-[-0.01em] text-foreground/80">
                            {displayName}
                          </span>
                          <Badge variant="soft" className="mt-1 px-2 py-0 text-[11px]">
                            Encerrado
                          </Badge>
                        </span>
                      </button>
                      {canonical && (
                        <div className="pl-1 pr-3">
                          <FunnelActionsMenu
                            pipeline={canonical}
                            displayName={displayName}
                          />
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ── Estado vazio ─────────────────────────────────────
              Antes aparecia mesmo COM funis na tela ("seus funis estruturais estão
              prontos, crie os customizados"). Sem as duas espécies, a frase não
              fazia mais sentido — e o vazio só é vazio quando não há funil algum. */}
          {allFunnels.length === 0 && endedTemporary.length === 0 && (
            <div className="flex flex-col items-center rounded-panel border border-dashed border-border bg-card/50 px-6 py-14 text-center">
              <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
                <GitBranch className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="text-base font-bold tracking-tight">
                Nenhum funil por aqui ainda
              </h3>
              <p className="mx-auto mb-5 mt-1 max-w-sm text-sm text-muted-foreground">
                Crie um funil para organizar sua operação
              </p>
              <Button onClick={() => setCreateOpen(true)} variant="outline">
                <Plus />
                Criar funil
              </Button>
            </div>
          )}
        </>
      )}

      <CreateFunilOuCampanhaModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
