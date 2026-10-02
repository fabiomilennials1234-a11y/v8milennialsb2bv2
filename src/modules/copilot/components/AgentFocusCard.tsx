/**
 * AgentFocusCard — "Agente em foco", o cartão de ouro da lista do Copilot.
 *
 * SÓ FORMA: os dados vêm da linha do agente (`copilot_agents`) e de
 * `useAgentMetrics` (30 dias); as ações são as MESMAS da lista antiga —
 * ativar/desativar passa pelo `onToggle` da página, que mantém a confirmação
 * de "agente sem funis". O switch de ativação mora só aqui (D13): a linha da
 * lista mostra o estado num selo.
 *
 * Do `useAgentMetrics` só entram os números que são DO agente (conversas e
 * leads atendidos filtram `agent_id`). Reuniões e qualificações saem de
 * `agent_decision_logs` filtrados só por organização — por agente seriam o
 * número da org repetido, então ficam fora deste cartão.
 */
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, ArrowRight, Cpu, MoreHorizontal, Sparkles, Star, Trash2 } from "lucide-react";
import { DeltaChip, FocusCard, FocusTile } from "@/components/ui/bento";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAgentMetrics } from "@/modules/copilot/hooks/useAgentMetrics";
import type { CopilotAgentWithRelations } from "@/types/copilot";
import { cn } from "@/lib/utils";
import { agentTypeLabel, energyLabel, styleLabel, temperatureLabel, toneLabel } from "@/modules/copilot/lib/agent-labels";

const onGoldButton =
  "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground [&_svg]:h-3.5 [&_svg]:w-3.5";

interface AgentFocusCardProps {
  agent: CopilotAgentWithRelations;
  canManage: boolean;
  builderEnabled: boolean;
  pipeLabels: string[];
  connectionLabel: string | null;
  togglePending: boolean;
  setDefaultPending: boolean;
  deletePending: boolean;
  onToggle: () => void;
  onSetDefault: () => void;
  onConfigure: () => void;
  onReviewWithBuilder: () => void;
  onDelete: () => void;
}

export function AgentFocusCard({
  agent,
  canManage,
  builderEnabled,
  pipeLabels,
  connectionLabel,
  togglePending,
  setDefaultPending,
  deletePending,
  onToggle,
  onSetDefault,
  onConfigure,
  onReviewWithBuilder,
  onDelete,
}: AgentFocusCardProps) {
  const { data: metrics, isLoading: metricsLoading } = useAgentMetrics(agent.id, "30d");
  const skills = agent.skills ?? [];
  const edited = agent.updated_at
    ? formatDistanceToNow(new Date(agent.updated_at), { addSuffix: true, locale: ptBR })
    : null;
  const conv = metrics?.trends.conversations;

  return (
    <FocusCard className="gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-primary-foreground/70">Agente em foco · {agentTypeLabel(agent.template_type)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-[1.6rem] font-extrabold leading-[1.1] tracking-[-0.035em]">{agent.name}</h3>
            {agent.llm_model && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-foreground px-2.5 py-1 text-[11px] font-bold text-primary">
                <Cpu className="h-3 w-3" aria-hidden />
                {agent.llm_model}
              </span>
            )}
            {agent.is_default && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] px-2.5 py-1 text-[11px] font-bold">
                <Star className="h-3 w-3 fill-current" aria-hidden />
                Padrão
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <label className="inline-flex h-9 items-center gap-2.5 rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] pl-3.5 pr-1.5 text-[13px] font-bold">
              {agent.is_active ? "Ativo" : "Inativo"}
              <Switch
                checked={!!agent.is_active}
                disabled={togglePending}
                onCheckedChange={onToggle}
                aria-label={agent.is_active ? `Desativar ${agent.name}` : `Ativar ${agent.name}`}
                className="data-[state=checked]:bg-primary-foreground data-[state=unchecked]:bg-primary-foreground/20"
              />
            </label>
          ) : (
            <span className="inline-flex h-9 items-center rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] px-3.5 text-[13px] font-bold">
              {agent.is_active ? "Ativo" : "Inativo"}
            </span>
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Mais ações de ${agent.name}`}
                  className="grid h-9 w-9 place-items-center rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] transition-colors hover:bg-primary-foreground/[.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!agent.is_default && agent.is_active && (
                  <DropdownMenuItem onSelect={onSetDefault} disabled={setDefaultPending}>
                    <Star />
                    Tornar padrão
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onSelect={onDelete}
                  disabled={deletePending}
                  aria-label={`Excluir ${agent.name}`}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <FocusTile>
          <p className="text-[11px] font-bold text-primary-foreground/65">Conversas · 30 dias</p>
          <p className={cn("mt-1 text-[1.5rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums", metricsLoading && "animate-pulse opacity-50")}>
            {metricsLoading ? "—" : (metrics?.totalConversations ?? 0).toLocaleString("pt-BR")}
          </p>
          {conv && conv.previous > 0 ? (
            <DeltaChip value={conv.percentChange} label="vs. 30 dias antes" className="mt-1.5 text-primary-foreground [&_span]:text-primary-foreground/65" />
          ) : (
            <p className="mt-1.5 text-[11px] text-primary-foreground/65">iniciadas por este agente</p>
          )}
        </FocusTile>
        <FocusTile>
          <p className="text-[11px] font-bold text-primary-foreground/65">Leads atendidos · 30 dias</p>
          <p className={cn("mt-1 text-[1.5rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums", metricsLoading && "animate-pulse opacity-50")}>
            {metricsLoading ? "—" : (metrics?.leadsAttended ?? 0).toLocaleString("pt-BR")}
          </p>
          <p className="mt-1.5 text-[11px] text-primary-foreground/65">leads diferentes</p>
        </FocusTile>
        <FocusTile>
          <p className="text-[11px] font-bold text-primary-foreground/65">Habilidades</p>
          <p className="mt-1 text-[1.5rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{skills.length}</p>
          <p className="mt-1.5 text-[11px] text-primary-foreground/65">configuradas</p>
        </FocusTile>
        <FocusTile>
          <p className="text-[11px] font-bold text-primary-foreground/65">Funis ativos</p>
          <p className="mt-1 text-[1.5rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">{pipeLabels.length}</p>
          <p className="mt-1.5 text-[11px] text-primary-foreground/65">onde o agente atua</p>
        </FocusTile>
      </div>

      <FocusTile className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5 text-[13px]">
          <p>
            <span className="text-primary-foreground/65">Personalidade </span>
            <span className="font-bold">
              {[toneLabel(agent.personality_tone), styleLabel(agent.personality_style), energyLabel(agent.personality_energy)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
          {agent.llm_temperature_mode && (
            <p>
              <span className="text-primary-foreground/65">Estilo de resposta </span>
              <span className="font-bold">{temperatureLabel(agent.llm_temperature_mode)}</span>
            </p>
          )}
        </div>
        {skills.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Habilidades">
            {skills.slice(0, 8).map((s) => (
              <li
                key={s}
                className="rounded-full border border-primary-foreground/15 bg-primary-foreground/[.07] px-2.5 py-1 text-[11.5px] font-bold"
              >
                {s}
              </li>
            ))}
            {skills.length > 8 && (
              <li className="rounded-full bg-primary-foreground/[.12] px-2 py-1 text-[11px] font-extrabold tabular-nums">+{skills.length - 8}</li>
            )}
          </ul>
        )}
      </FocusTile>

      {pipeLabels.length === 0 && (
        <p className="flex items-center gap-2 rounded-2xl bg-primary-foreground px-3.5 py-2.5 text-[12.5px] font-bold text-primary">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Nenhum funil — configure antes de ativar.
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-primary-foreground/15 pt-4">
        <dl className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
          <div className="min-w-0">
            <dt className="text-[11px] font-bold text-primary-foreground/65">Funis ativos</dt>
            <dd className="max-w-[260px] truncate font-bold">{pipeLabels.length ? pipeLabels.join(", ") : "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-bold text-primary-foreground/65">Conexão</dt>
            <dd className="max-w-[200px] truncate font-bold">{connectionLabel ?? "Sem número"}</dd>
          </div>
          {edited && (
            <div className="min-w-0">
              <dt className="text-[11px] font-bold text-primary-foreground/65">Última edição</dt>
              <dd className="font-bold">{edited}</dd>
            </div>
          )}
        </dl>
        <div className="flex items-center gap-2">
          {canManage && builderEnabled && (
            <button
              type="button"
              onClick={onReviewWithBuilder}
              className={cn(onGoldButton, "border border-primary-foreground/15 bg-primary-foreground/[.07] hover:bg-primary-foreground/[.12]")}
            >
              <Sparkles />
              Revisar com IA
            </button>
          )}
          <button
            type="button"
            onClick={onConfigure}
            className={cn(onGoldButton, "bg-tinta-foreground text-primary-foreground shadow-relevo hover:bg-tinta-foreground/90")}
          >
            Configurar
            <ArrowRight />
          </button>
        </div>
      </div>
    </FocusCard>
  );
}
