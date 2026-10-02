import { isPipelineVisible, selectVisiblePipelines } from "../lib/pipeline-navigation";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTemporaryFunnels } from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import { useOrganization } from "@/modules/identity";
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
  ArrowRight,
  ChevronDown,
} from "lucide-react";
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
  const { data: temporaryFunnels = [], isLoading: temporaryLoading } = useTemporaryFunnels();
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();

  // Registro único → cor/ícone reais de qualquer funil.
  const pipeById = new Map(pipelines.map((p) => [p.id, p] as const));
  const temporaryById = new Map(temporaryFunnels.map((p) => [p.id, p] as const));
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
        daysLeft !== null ? `${daysLeft}d restantes` : null,
        pipe?.team_goal != null ? `Meta: ${pipe.team_goal}` : null,
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
        pipeline,
      };
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Funis"
        subtitle="Gerencie seus funis de vendas"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            Criar
          </Button>
        }
      />

      {/* Carregando: o esqueleto já tem a forma da grade — o cabeçalho não
          espera dado nenhum, então ele não some enquanto a lista chega. */}
      {isLoading ? (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          aria-busy="true"
          aria-label="Carregando funis"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[84px] rounded-card" />
          ))}
        </div>
      ) : (
        <>
          {/* Uma lista só. A linha abaixo do nome mostra apenas fatos do funil,
              como prazo, meta e estado. */}
          {allFunnels.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {allFunnels.map((funil) => (
                /* O cartão deixou de ser um <button> só: agora ele hospeda o menu
                   de ações, e botão dentro de botão é HTML inválido (o menu nem
                   abriria). A área de navegação continua sendo um botão — só que
                   agora ela é o miolo do cartão, e o menu é irmão dela. */
                <div
                  key={funil.key}
                  className={cn(
                    "group flex items-center rounded-card border border-card-border bg-card text-card-foreground shadow-relevo",
                    "transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-relevo-alto",
                    "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                  )}
                >
                  <button
                    onClick={() => navigate(funil.path)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3.5 rounded-card p-[18px] text-left",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    {/* Cor e ícone que o usuário escolheu — tinta translúcida
                        sobre o cartão, que assenta nos dois temas. */}
                    <span
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]"
                      style={{ backgroundColor: `color-mix(in srgb, ${funil.color} 14%, transparent)` }}
                    >
                      <funil.icon className="h-5 w-5" style={{ color: funil.color }} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold tracking-[-0.01em]">
                        {funil.name}
                      </span>
                      {funil.meta && (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {funil.meta}
                        </span>
                      )}
                    </span>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
                      aria-hidden
                    />
                  </button>
                  {funil.pipeline && (
                    <div className="pl-1 pr-3">
                      <FunnelActionsMenu pipeline={funil.pipeline} displayName={funil.name} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Encerrados (recolhidos) ─────────────────────────── */}
          {endedTemporary.length > 0 && (
            <section className="space-y-3">
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
