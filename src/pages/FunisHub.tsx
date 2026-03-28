import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomPipelines } from "@/hooks/useCustomPipelines";
import { useCampanhas } from "@/hooks/useCampanhas";
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
  Users,
  Trophy,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { CreateFunilOuCampanhaModal } from "@/components/funis/CreateFunilOuCampanhaModal";

// Default funnels (hardcoded routes)
const DEFAULT_FUNNELS = [
  { label: "Oportunidades", icon: MessageSquare, path: "/pipe-whatsapp", color: "#3b82f6" },
  { label: "Agendamentos", icon: Calendar, path: "/pipe-confirmacao", color: "#8b5cf6" },
  { label: "Orçamentos", icon: Kanban, path: "/pipe-propostas", color: "#f97316" },
  { label: "Carteira", icon: TrendingUp, path: "/upsell", color: "#ec4899" },
];

export default function FunisHub() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { data: customPipelines = [], isLoading: pipesLoading } = useCustomPipelines();
  const { data: campanhas = [], isLoading: campanhasLoading } = useCampanhas();
  const [createOpen, setCreateOpen] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  useEffect(() => { trackModuleVisit("funis", organizationId); }, []);

  const isLoading = pipesLoading || campanhasLoading;

  const activeCampanhas = campanhas.filter((c) => c.is_active && c.status !== "ended");
  const endedCampanhas = campanhas.filter((c) => !c.is_active || c.status === "ended");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Funis & Campanhas</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gerencie seus funis de vendas e campanhas temporárias
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Criar
        </Button>
      </div>

      {/* Structural Funnels */}
      <div>
        <h2 className="text-sm font-semibold text-foreground/60 uppercase tracking-wider mb-3">Funis Estruturais</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {DEFAULT_FUNNELS.map((funnel) => (
            <button
              key={funnel.path}
              onClick={() => navigate(funnel.path)}
              className="group flex items-center gap-3 p-4 rounded-xl border border-border/50 hover:border-border bg-card hover:bg-muted/30 transition-all text-left"
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: funnel.color + "15" }}
              >
                <funnel.icon className="w-5 h-5" style={{ color: funnel.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{funnel.label}</p>
                <p className="text-xs text-muted-foreground">Funil permanente</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </div>

      {/* Custom Funnels */}
      {customPipelines.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground/60 uppercase tracking-wider mb-3">Funis Customizados</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {customPipelines.map((pipe) => (
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
                  <p className="text-sm font-semibold truncate">{pipe.name}</p>
                  <p className="text-xs text-muted-foreground">Funil customizado</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active Campaigns */}
      {activeCampanhas.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground/60 uppercase tracking-wider mb-3">Campanhas Ativas</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeCampanhas.map((campanha) => {
              const daysLeft = Math.max(0, Math.ceil((new Date(campanha.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
              return (
                <button
                  key={campanha.id}
                  onClick={() => navigate(`/campanhas/${campanha.id}`)}
                  className="group p-4 rounded-xl border border-border/50 hover:border-primary/30 bg-card hover:bg-primary/5 transition-all text-left"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Target className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold truncate">{campanha.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                            Campanha
                          </span>
                          <span className={cn(
                            "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md",
                            campanha.status === "active" ? "bg-green-500/10 text-green-500" :
                            campanha.status === "paused" ? "bg-yellow-500/10 text-yellow-500" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {campanha.status === "active" ? "Ativa" : campanha.status === "paused" ? "Pausada" : campanha.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{daysLeft}d restantes</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Trophy className="w-3 h-3" />
                      <span>Meta: {campanha.team_goal}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Ended Campaigns (collapsible) */}
      {endedCampanhas.length > 0 && (
        <div>
          <button
            onClick={() => setShowEnded(!showEnded)}
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={cn("w-4 h-4 transition-transform", showEnded && "rotate-180")} />
            {endedCampanhas.length} campanha{endedCampanhas.length > 1 ? "s" : ""} encerrada{endedCampanhas.length > 1 ? "s" : ""}
          </button>
          {showEnded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3 opacity-60">
              {endedCampanhas.map((campanha) => (
                <button
                  key={campanha.id}
                  onClick={() => navigate(`/campanhas/${campanha.id}`)}
                  className="p-4 rounded-xl border border-border/50 bg-card text-left"
                >
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium truncate">{campanha.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Encerrada</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state when nothing exists */}
      {customPipelines.length === 0 && campanhas.length === 0 && (
        <div className="text-center py-12 bg-muted/20 rounded-xl border border-border/30">
          <GitBranch className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-semibold mb-1">Seus funis estruturais estão prontos</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Crie funis customizados ou campanhas temporárias para organizar sua operação
          </p>
          <Button onClick={() => setCreateOpen(true)} variant="outline" className="gap-2">
            <Plus className="w-4 h-4" />
            Criar funil ou campanha
          </Button>
        </div>
      )}

      <CreateFunilOuCampanhaModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
