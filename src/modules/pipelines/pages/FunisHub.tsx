import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePermanentCustomFunnels, useTemporaryFunnels } from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { usePipelineDisplayConfig } from "@/modules/pipelines/hooks/config/usePipelineDisplayConfig";
import { useOrganization } from "@/modules/identity";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { trackModuleVisit } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  GitBranch,
  Plus,
  Loader2,
  Kanban,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { CreateFunilOuCampanhaModal } from "@/modules/pipelines/components/funis/CreateFunilOuCampanhaModal";
// Mesma tabela de cor que o seletor da faixa usa — as duas telas não podem
// discordar sobre a cor de um funil.
import { FUNNEL_COLOR_MAP } from "../lib/funnel-nav";

const PIPE_PATH_MAP: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
  upsell: "/upsell",
};

const FALLBACK_COLOR = "#64748b";

/**
 * Um funil na lista. Sem espécie e sem ícone próprio — mas COM cor.
 *
 * Cor não separa: separa quando só um lado tem. Todo funil aqui tem a sua (a
 * do `pipe_type` para os da org, a escolhida pelo usuário para os criados por
 * ele), então ela identifica o funil sem sugerir que existem duas classes. É a
 * mesma regra que o `FunnelSwitcher` já seguia.
 */
interface FunilCard {
  key: string;
  name: string;
  path: string;
  color: string;
  /** Linha de apoio: prazo, meta, estado. Vazia quando não há o que dizer. */
  meta?: string;
}

// ── Component ────────────────────────────────────────────────

export default function FunisHub() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { hasFeature } = useOrgFeatures();
  const { data: displayConfigs = [], isLoading: configLoading } = usePipelineDisplayConfig();
  const { data: permanentFunnels = [], isLoading: permanentLoading } = usePermanentCustomFunnels();
  const { data: temporaryFunnels = [], isLoading: temporaryLoading } = useTemporaryFunnels();
  const [createOpen, setCreateOpen] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  useEffect(() => {
    trackModuleVisit("funis", organizationId);
  }, []);

  const isLoading = configLoading || permanentLoading || temporaryLoading;

  // Structural funnels — only visible ones; Agendamentos some quando o merge está ON (ADR-0004)
  const visibleStructural = displayConfigs.filter(
    (c) => c.is_visible && !(c.pipe_type === "confirmacao" && hasFeature("merged_opportunity_funnel")),
  );

  // Encerrado não é categoria, é ESTADO — por isso segue recolhido no fim.
  const activeTemporary = temporaryFunnels.filter((f) => f.status !== "ended");
  const endedTemporary = temporaryFunnels.filter((f) => f.status === "ended");

  const allFunnels: FunilCard[] = [
    ...visibleStructural.map((c) => ({
      key: `sys:${c.pipe_type}`,
      name: c.display_name,
      path: PIPE_PATH_MAP[c.pipe_type] ?? "/funis",
      color: FUNNEL_COLOR_MAP[c.pipe_type] ?? FALLBACK_COLOR,
    })),
    ...permanentFunnels.map((pipe) => ({
      key: pipe.id,
      name: pipe.name,
      path: `/funil/${pipe.slug}`,
      color: pipe.color ?? FALLBACK_COLOR,
    })),
    ...activeTemporary.map((pipe) => {
      const daysLeft = pipe.ends_at
        ? Math.max(
            0,
            Math.ceil((new Date(pipe.ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          )
        : null;
      // Só o que é fato do funil. "Ativo" não entra: é o estado de todos os
      // outros da lista também, e dizê-lo só aqui recriaria a distinção.
      const partes = [
        daysLeft !== null ? `${daysLeft}d restantes` : null,
        pipe.team_goal != null ? `Meta: ${pipe.team_goal}` : null,
        pipe.status === "paused" ? "Pausado" : null,
        pipe.status === "draft" ? "Rascunho" : null,
      ].filter(Boolean);
      return {
        key: pipe.id,
        name: pipe.name,
        path: `/funil/${pipe.slug}`,
        color: pipe.color ?? FALLBACK_COLOR,
        meta: partes.length > 0 ? partes.join(" · ") : undefined,
      };
    }),
  ];

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

      {/* ── Os funis ─────────────────────────────────────────
          Uma lista só. Havia três seções tituladas — "Funis Estruturais",
          "Funis Customizados", "Funis com Prazo — Ativos" — cada uma com
          ícone, cor, grid e legenda próprios. Não são espécies diferentes:
          são todos funis. O que sobra abaixo do nome é FATO do funil (prazo,
          meta, pausado), nunca a categoria a que ele pertencia. */}
      {allFunnels.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {allFunnels.map((funil) => (
            <button
              key={funil.key}
              onClick={() => navigate(funil.path)}
              className="group flex items-center gap-3 p-4 rounded-xl border border-border/50 hover:border-border bg-card hover:bg-muted/30 transition-all text-left"
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: funil.color + "15" }}
              >
                <Kanban className="w-5 h-5" style={{ color: funil.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{funil.name}</p>
                {funil.meta && (
                  <p className="text-xs text-muted-foreground truncate">{funil.meta}</p>
                )}
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
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
                  onClick={() => navigate(`/funil/${pipe.slug}`)}
                  className="p-4 rounded-xl border border-border/50 bg-card text-left"
                >
                  <div className="flex items-center gap-2">
                    <Kanban className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium truncate">{pipe.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Encerrado</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Estado vazio ─────────────────────────────────────
          Antes aparecia mesmo COM funis na tela ("seus funis estruturais estão
          prontos, crie os customizados"). Sem as duas espécies, a frase não
          fazia mais sentido — e o vazio só é vazio quando não há funil algum. */}
      {allFunnels.length === 0 && endedTemporary.length === 0 && (
        <div className="text-center py-12 bg-muted/20 rounded-xl border border-border/30">
          <GitBranch className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-base font-semibold mb-1">
            Nenhum funil por aqui ainda
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Crie um funil para organizar sua operação
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
