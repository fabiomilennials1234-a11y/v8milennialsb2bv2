/**
 * /master/stage-roles — revisão master das sugestões won/lost (#991).
 *
 * O Stage Role Classifier (ADR-0006 pattern) auto-aplica meeting_booked /
 * meeting_held em etapas custom, mas won/lost = dinheiro (ADR-0017 §1) e
 * param AQUI até um humano aprovar, corrigir ou dispensar. Uma passada pelas
 * ~30 orgs: fila agrupada por organização, decisão por etapa.
 *
 * Acesso: só master (MasterRoute + RLS master_all_pipeline_stages).
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Check,
  CircleDollarSign,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  STAGE_ROLES_ATRIBUIVEIS,
  STAGE_ROLE_META,
  STAGE_ROLE_SOURCE_LABEL,
  type StageRole,
} from "@/modules/pipelines";
import {
  useReviewStageRoleSuggestion,
  useStageRoleSuggestions,
} from "../hooks/useStageRoleSuggestions";
import {
  groupSuggestionsByOrg,
  type StageRoleSuggestionRow,
} from "../lib/stage-role-review";

function pipeLabel(row: StageRoleSuggestionRow): string {
  // O funil como a ORG o vê (resolvido no hook via nomeDoFunil) — nunca o
  // catálogo. Etapa órfã (pipeline_id nulo) ganha o fallback honesto.
  return row.funil_label ?? "Funil removido";
}

function SuggestionRow({ row }: { row: StageRoleSuggestionRow }) {
  const review = useReviewStageRoleSuggestion();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const suggestedMeta = STAGE_ROLE_META[row.suggested_stage_role];

  const act = (action: "approve" | "dismiss") => {
    setPendingAction(action);
    review.mutate({ row, action }, { onSettled: () => setPendingAction(null) });
  };

  const correct = (role: StageRole) => {
    setPendingAction("correct");
    review.mutate(
      { row, action: "correct", correctedRole: role },
      { onSettled: () => setPendingAction(null) },
    );
  };

  const busy = review.isPending;

  return (
    <div className="group flex flex-wrap items-center gap-3 px-4 py-3 border-t border-border/50 first:border-t-0 hover:bg-muted/30 transition-colors">
      {/* Etapa */}
      <div className="flex items-center gap-3 min-w-0 flex-1 basis-64">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-background"
          style={{ backgroundColor: row.color || "#64748b" }}
        />
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{row.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {pipeLabel(row)}
            <span className="mx-1.5 opacity-40">·</span>
            <span className="font-mono opacity-70">{row.stage_key}</span>
          </p>
        </div>
      </div>

      {/* Sugestão */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="w-3 h-3" />
          {STAGE_ROLE_SOURCE_LABEL[row.stage_role_suggestion_source ?? ""] ?? "Classifier"}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium border px-2.5 py-1 rounded-full",
            suggestedMeta.badgeClassName,
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", suggestedMeta.dotClassName)} />
          {suggestedMeta.label}
        </span>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        <Button
          size="sm"
          className="h-8"
          disabled={busy}
          onClick={() => act("approve")}
        >
          {pendingAction === "approve" ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5 mr-1.5" />
          )}
          Aprovar
        </Button>
        <Select
          value=""
          disabled={busy}
          onValueChange={(v) => correct(v as StageRole)}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="Corrigir para…" />
          </SelectTrigger>
          <SelectContent>
            {/* B2d: won/lost saíram das opções. Aprovar um deles reativaria o
                registro de venda por arrastar naquela etapa, contra o modelo
                em que o desfecho do NEGÓCIO decide. A fila herdada de 163
                sugestões de dinheiro foi encerrada pela migration
                `a_fila_de_won_lost_se_aposenta`; o que sobrar aqui só pode ser
                corrigido para um papel que ainda existe. */}
            {STAGE_ROLES_ATRIBUIVEIS.filter((r) => r !== row.suggested_stage_role).map((role) => (
              <SelectItem key={role} value={role}>
                <div className="flex items-center gap-2">
                  <span className={cn("w-1.5 h-1.5 rounded-full", STAGE_ROLE_META[role].dotClassName)} />
                  {STAGE_ROLE_META[role].label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Dispensar — manter etapa sem role terminal"
          disabled={busy}
          onClick={() => act("dismiss")}
        >
          {pendingAction === "dismiss" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <X className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export default function MasterStageRoleReview() {
  const { data: rows, isLoading } = useStageRoleSuggestions();
  const groups = groupSuggestionsByOrg(rows ?? []);
  const total = rows?.length ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
            Refundação de métricas · ADR-0017
          </p>
          <h1 className="text-2xl font-bold tracking-tight">
            Revisão de etapas Won / Lost
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            O classifier sugeriu roles de venda para etapas custom das
            organizações. Won e Lost movem dinheiro — nada é aplicado sem a sua
            confirmação.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <CircleDollarSign className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold leading-none tabular-nums">{total}</p>
            <p className="text-xs text-muted-foreground mt-1">
              pendente{total === 1 ? "" : "s"} · {groups.length} org
              {groups.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      {/* Fila */}
      {isLoading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-dashed bg-card/50 py-16 flex flex-col items-center gap-3 text-center"
        >
          <div className="p-3 rounded-full bg-emerald-500/10">
            <BadgeCheck className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <p className="font-medium">Fila limpa</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Nenhuma sugestão de Won/Lost aguardando revisão. Novas etapas
              custom entram aqui automaticamente quando o classifier rodar.
            </p>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {groups.map((group, index) => (
            <motion.section
              key={group.orgId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-xl border bg-card overflow-hidden"
            >
              <header className="flex items-center justify-between px-4 py-3 bg-muted/40">
                <h2 className="font-semibold text-sm">{group.orgName}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.suggestions.length} sugestão
                  {group.suggestions.length === 1 ? "" : "es"}
                </span>
              </header>
              <div>
                {group.suggestions.map((row) => (
                  <SuggestionRow key={row.id} row={row} />
                ))}
              </div>
            </motion.section>
          ))}
        </div>
      )}
    </div>
  );
}
