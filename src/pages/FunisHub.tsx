import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePermanentCustomFunnels, useTemporaryFunnels } from "@/hooks/useCustomPipelines";
import { usePipelineDisplayConfig } from "@/hooks/usePipelineDisplayConfig";
import { useOrganization } from "@/hooks/useOrganization";
import { trackModuleVisit } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  GitBranch,
  Target,
  Plus,
  Loader2,
  MessageSquare,
  Calendar,
  Kanban,
  TrendingUp,
  Clock,
  Trophy,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { CreateFunilOuCampanhaModal } from "@/components/funis/CreateFunilOuCampanhaModal";

// ── Maps for structural funnels ──────────────────────────────

const PIPE_ICON_MAP: Record<string, React.ElementType> = {
  whatsapp: MessageSquare,
  confirmacao: Calendar,
  propostas: Kanban,
  upsell: TrendingUp,
};

const PIPE_PATH_MAP: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
  upsell: "/upsell",
};

const PIPE_COLOR_MAP: Record<string, string> = {
  whatsapp: "#3b82f6",
  confirmacao: "#8b5cf6",
  propostas: "#f97316",
  upsell: "#ec4899",
};

// ── Component ────────────────────────────────────────────────

export default function FunisHub() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { data: displayConfigs = [], isLoading: configLoading } = usePipelineDisplayConfig();
  const { data: permanentFunnels = [], isLoading: permanentLoading } = usePermanentCustomFunnels();
  const { data: temporaryFunnels = [], isLoading: temporaryLoading } = useTemporaryFunnels();
  const [createOpen, setCreateOpen] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  useEffect(() => {
    trackModuleVisit("funis", organizationId);
  }, []);

  const isLoading = configLoading || permanentLoading || temporaryLoading;

  // Structural funnels — only visible ones
  const visibleStructural = displayConfigs.filter((c) => c.is_visible);

  // Temporary funnels — active vs ended
  const activeTemporary = temporaryFunnels.filter((f) => f.status !== "ended");
  const endedTemporary = temporaryFunnels.filter((f) => f.status === "ended");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Funis</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie seus funis de vendas
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Criar
        </Button>
      </div>

      {/* ── Funis Estruturais ───────────────────────────────── */}
      {visibleStructural.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground/60 uppercase tracking-wider mb-3">
            Funis Estruturais
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {visibleStructural.map((config) => {
              const Icon = PIPE_ICON_MAP[config.pipe_type] || Kanban;
              const path = PIPE_PATH_MAP[config.pipe_type];
              const color = PIPE_COLOR_MAP[config.pipe_type] || "#64748b";

              return (
                <button
                  key={config.pipe_type}
                  onClick={() => navigate(path)}
                  className="group flex items-center gap-3 p-4 rounded-xl border border-border/50 hover:border-border bg-card hover:bg-muted/30 transition-all text-left"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: color + "15" }}
                  >
                    <Icon className="w-5 h-5" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{config.display_name}</p>
                    <p className="text-xs text-muted-foreground">Funil permanente</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Funis Customizados ──────────────────────────────── */}
      {permanentFunnels.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground/60 uppercase tracking-wider mb-3">
            Funis Customizados
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {permanentFunnels.map((pipe) => (
              <button
                key={pipe.id}
                onClick={() => navigate(`/pipe/custom/${pipe.slug}`)}
                className="group flex items-center gap-3 p-4 rounded-xl border border-border/50 hover:border-border bg-card hover:bg-muted/30 transition-all text-left"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: pipe.color + "15" }}
                >
                  <GitBranch className="w-5 h-5" style={{ color: pipe.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">{pipe.name}</p>
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 flex-shrink-0">
                      Permanente
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Funil customizado</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Funis com Prazo — Ativos ──────────────────────── */}
      {activeTemporary.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground/60 uppercase tracking-wider mb-3">
            Funis com Prazo — Ativos
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeTemporary.map((pipe) => {
              const daysLeft = pipe.ends_at
                ? Math.max(
                    0,
                    Math.ceil(
                      (new Date(pipe.ends_at).getTime() - Date.now()) /
                        (1000 * 60 * 60 * 24)
                    )
                  )
                : null;

              return (
                <button
                  key={pipe.id}
                  onClick={() => navigate(`/pipe/custom/${pipe.slug}`)}
                  className="group p-4 rounded-xl border border-border/50 hover:border-primary/30 bg-card hover:bg-primary/5 transition-all text-left"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Target className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold truncate">{pipe.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className={cn(
                              "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md",
                              pipe.status === "active"
                                ? "bg-green-500/10 text-green-500"
                                : pipe.status === "paused"
                                ? "bg-yellow-500/10 text-yellow-500"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {pipe.status === "active"
                              ? "Ativo"
                              : pipe.status === "paused"
                              ? "Pausado"
                              : "Draft"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Progress info */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    {daysLeft !== null && (
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{daysLeft}d restantes</span>
                      </div>
                    )}
                    {pipe.team_goal != null && (
                      <div className="flex items-center gap-1">
                        <Trophy className="w-3 h-3" />
                        <span>Meta: {pipe.team_goal}</span>
                      </div>
                    )}
                  </div>

                  {/* Progress bar (goal-based) */}
                  {pipe.team_goal != null && pipe.team_goal > 0 && (
                    <div className="mt-3">
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        {/*
                          Without querying entries we cannot show achieved count,
                          so we render the bar track as a placeholder.
                          If achieved data becomes available, fill width accordingly.
                        */}
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: "0%" }}
                        />
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Encerrados (collapsed) ──────────────────────────── */}
      {endedTemporary.length > 0 && (
        <div>
          <button
            onClick={() => setShowEnded(!showEnded)}
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={cn(
                "w-4 h-4 transition-transform",
                showEnded && "rotate-180"
              )}
            />
            {endedTemporary.length} funil{endedTemporary.length > 1 ? "s" : ""}{" "}
            encerrado{endedTemporary.length > 1 ? "s" : ""}
          </button>
          {showEnded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3 opacity-60">
              {endedTemporary.map((pipe) => (
                <button
                  key={pipe.id}
                  onClick={() => navigate(`/pipe/custom/${pipe.slug}`)}
                  className="p-4 rounded-xl border border-border/50 bg-card text-left"
                >
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium truncate">{pipe.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Encerrado</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────── */}
      {permanentFunnels.length === 0 && temporaryFunnels.length === 0 && (
        <div className="text-center py-12 bg-muted/20 rounded-xl border border-border/30">
          <GitBranch className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-semibold mb-1">
            Seus funis estruturais estao prontos
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Crie funis customizados para organizar sua operação
          </p>
          <Button
            onClick={() => setCreateOpen(true)}
            variant="outline"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            Criar funil
          </Button>
        </div>
      )}

      <CreateFunilOuCampanhaModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
