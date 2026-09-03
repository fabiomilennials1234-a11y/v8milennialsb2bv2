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
import { FunnelActionsMenu } from "@/modules/pipelines/components/funis/FunnelActionsMenu";
import { usePipelines, type Pipeline } from "@/modules/pipelines/hooks/model/usePipelines";
import { funisDeSistemaNavegaveis } from "@/contracts/pipe/nome-do-funil";
import { funilIcon } from "../lib/funil-icons";
// Mesmo path map compat do seletor da faixa (morre no flip do redirect).
import { FUNNEL_FALLBACK_COLOR } from "../lib/funnel-nav";
import type { LucideIcon } from "lucide-react";

/**
 * Um funil na lista — com a cor e o ícone QUE O USUÁRIO ESCOLHEU.
 *
 * Cor/ícone vêm de `pipelines` (registro único, SCRUM-637): funil de sistema
 * persiste personalização como qualquer outro, e o hub reflete. Nome de
 * sistema continua vindo do display_config (rename legado prevalece).
 */
interface FunilCard {
  key: string;
  name: string;
  path: string;
  color: string;
  icon: LucideIcon;
  /** Linha de apoio: prazo, meta, estado. Vazia quando não há o que dizer. */
  meta?: string;
  /**
   * Linha canônica em `pipelines` — o que o menu de ações precisa para
   * renomear/excluir. Ausente só enquanto o registro não chegou: sem ela o
   * cartão continua listando e navegando, apenas sem menu.
   */
  pipeline?: Pipeline;
}

// ── Component ────────────────────────────────────────────────

export default function FunisHub() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { hasFeature } = useOrgFeatures();
  const { data: displayConfigs = [], isLoading: configLoading } = usePipelineDisplayConfig();
  const { data: permanentFunnels = [], isLoading: permanentLoading } = usePermanentCustomFunnels();
  const { data: temporaryFunnels = [], isLoading: temporaryLoading } = useTemporaryFunnels();
  const { data: pipelines = [] } = usePipelines();

  // Registro único → cor/ícone reais de qualquer funil.
  const pipeBySlug = new Map(pipelines.map((p) => [p.slug, p] as const));
  const pipeById = new Map(pipelines.map((p) => [p.id, p] as const));
  const [createOpen, setCreateOpen] = useState(false);
  const [showEnded, setShowEnded] = useState(false);

  useEffect(() => {
    trackModuleVisit("funis", organizationId);
  }, []);

  const isLoading = configLoading || permanentLoading || temporaryLoading;

  // Funis de sistema navegáveis — regra ÚNICA em contracts. O hub era o único
  // dos três consumidores que não filtrava a Carteira, e por isso listava um
  // card "Carteira" apontando para `/funil/upsell`, rota sem funil por trás.
  const visibleStructural = funisDeSistemaNavegaveis(displayConfigs, {
    mergeDeOportunidadesAtivo: hasFeature("merged_opportunity_funnel"),
  });

  // Encerrado não é categoria, é ESTADO — por isso segue recolhido no fim.
  const activeTemporary = temporaryFunnels.filter((f) => f.status !== "ended");
  const endedTemporary = temporaryFunnels.filter((f) => f.status === "ended");

  const allFunnels: FunilCard[] = [
    ...visibleStructural.map((c) => {
      const row = pipeBySlug.get(c.pipe_type);
      return {
        key: `sys:${c.pipe_type}`,
        name: c.display_name,
        path: `/funil/${c.pipe_type}`,
        color: row?.color ?? FUNNEL_FALLBACK_COLOR,
        icon: funilIcon(row?.icon),
        pipeline: row,
      };
    }),
    ...permanentFunnels.map((pipe) => ({
      key: pipe.id,
      name: pipe.name,
      path: `/funil/${pipe.slug}`,
      color: pipeById.get(pipe.id)?.color ?? pipe.color ?? FUNNEL_FALLBACK_COLOR,
      icon: funilIcon(pipeById.get(pipe.id)?.icon),
      pipeline: pipeById.get(pipe.id),
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
        color: pipeById.get(pipe.id)?.color ?? pipe.color ?? FUNNEL_FALLBACK_COLOR,
        icon: funilIcon(pipeById.get(pipe.id)?.icon),
        meta: partes.length > 0 ? partes.join(" · ") : undefined,
        pipeline: pipeById.get(pipe.id),
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
            /* O cartão deixou de ser um <button> só: agora ele hospeda o menu
               de ações, e botão dentro de botão é HTML inválido (o menu nem
               abriria). A área de navegação continua sendo um botão — só que
               agora ela é o miolo do cartão, e o menu é irmão dela. */
            <div
              key={funil.key}
              className="group flex items-center rounded-xl border border-border/50 hover:border-border bg-card hover:bg-muted/30 transition-all"
            >
              <button
                onClick={() => navigate(funil.path)}
                className="flex flex-1 min-w-0 items-center gap-3 p-4 text-left"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: funil.color + "15" }}
                >
                  <funil.icon className="w-5 h-5" style={{ color: funil.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{funil.name}</p>
                  {funil.meta && (
                    <p className="text-xs text-muted-foreground truncate">{funil.meta}</p>
                  )}
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              {funil.pipeline && (
                <div className="pr-3 pl-1">
                  <FunnelActionsMenu pipeline={funil.pipeline} displayName={funil.name} />
                </div>
              )}
            </div>
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
                /* Encerrado é estado, não espécie: o funil segue sendo funil e
                   ganha o mesmo menu — é justamente aqui que "excluir" costuma
                   ser o que a pessoa quer. */
                <div
                  key={pipe.id}
                  className="group flex items-start rounded-xl border border-border/50 bg-card"
                >
                  <button
                    onClick={() => navigate(`/funil/${pipe.slug}`)}
                    className="flex-1 min-w-0 p-4 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Kanban className="w-4 h-4 text-muted-foreground" />
                      <p className="text-sm font-medium truncate">{pipe.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Encerrado</p>
                  </button>
                  {pipeById.get(pipe.id) && (
                    <div className="pr-3 pt-4 pl-1">
                      <FunnelActionsMenu
                        pipeline={pipeById.get(pipe.id)!}
                        displayName={pipe.name}
                      />
                    </div>
                  )}
                </div>
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
