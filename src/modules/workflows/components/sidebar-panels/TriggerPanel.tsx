import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRIGGER_CATEGORIES } from "@/types/workflow";
import { useTeamMembers } from "@/modules/identity";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import type { TriggerNodeData, WorkflowTriggerType, ScheduledDispatchItem } from "@/types/workflow";
import { usePipelines, useEtapasDoFunil, useCustomPipelines, usePipelineDisplayConfig } from "@/modules/pipelines";
import { destinosDeSistema } from "@/contracts/pipe";
import { useCampanhas, useCampanhaStages } from "@/modules/campaigns/hooks/useCampanhas";
import { useLeadOrigins } from "@/modules/leads";
import { CampaignSelectorField } from "./CampaignSelectorField";

interface TriggerPanelProps {
  data: TriggerNodeData;
  onUpdate: (updates: Partial<TriggerNodeData>) => void;
}

export function TriggerPanel({ data, onUpdate }: TriggerPanelProps) {
  const cfg = (data.config || {}) as Record<string, unknown>;
  const { hasFeature } = useOrgFeatures();
  // Nome do funil de reuniões como a ORG o vê (SCRUM-641).
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const nomeConfirmacao =
    destinosDeSistema(displayConfigs).find((d) => d.pipeType === "confirmacao")?.label ??
    "Funil removido";
  // Categoria Negócios só aparece para org com o módulo ligado (feature `deals`).
  const triggerCategories = TRIGGER_CATEGORIES.filter(
    (c) => c.label !== "Negócios" || hasFeature("deals"),
  );

  const updateConfig = (updates: Record<string, unknown>) => {
    onUpdate({ config: { ...cfg, ...updates } as any });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Quando lead é criado"
        />
      </div>

      <div className="space-y-2">
        <Label>Tipo de Trigger</Label>
        <Select
          value={data.triggerType}
          onValueChange={(v) =>
            onUpdate({ triggerType: v as WorkflowTriggerType, config: {} as any })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o trigger" />
          </SelectTrigger>
          <SelectContent>
            {triggerCategories.map((cat) => (
              <SelectGroup key={cat.label}>
                <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                  {cat.label}
                </SelectLabel>
                {cat.triggers.map((t) => (
                  <SelectItem key={t} value={t}>
                    {/* We import TRIGGER_LABELS inline to avoid circular deps */}
                    {t === "lead_created" ? "Lead Criado" :
                     t === "stage_changed" ? "Mudança de Estágio" :
                     t === "tag_added" ? "Tag Adicionada" :
                     t === "score_reached" ? "Score Atingido" :
                     t === "cron" ? "Agendamento (Cron)" :
                     t === "lead_replied" ? "Lead Respondeu" :
                     t === "lead_no_reply" ? "Lead Não Respondeu" :
                     t === "meeting_confirmed" ? "Reunião Confirmada" :
                     t === "meeting_not_confirmed" ? "Reunião Não Confirmada" :
                     t === "meeting_held" ? "Compareceu à Reunião" :
                     t === "meeting_no_show" ? "Não Compareceu à Reunião" :
                     t === "proposal_accepted" ? "Proposta Aceita" :
                     t === "proposal_lost" ? "Proposta Perdida" :
                     t === "followup_overdue" ? "Follow-up Vencido" :
                     t === "webhook_received" ? "Webhook Recebido" :
                     t === "lead_assigned" ? "Lead Atribuído" :
                     t === "campaign_status_changed" ? "Status de Campanha Mudou" :
                     t === "lead_added_to_campaign" ? "Lead Entrou na Campanha" :
                     t === "lead_removed_from_campaign" ? "Lead Saiu da Campanha" :
                     t === "campaign_lead_replied" ? "Lead Respondeu na Campanha" :
                     t === "campaign_lead_no_reply" ? "Lead Não Respondeu na Campanha" :
                     t === "campaign_completed" ? "Lead Concluiu a Campanha" :
                     t === "field_changed" ? "Campo do Lead Alterado" :
                     t === "scheduled_date" ? "Antes de uma data" :
                     t === "deal_created" ? "Negócio Criado" :
                     t === "deal_won" ? "Negócio Ganho" :
                     t === "deal_lost" ? "Negócio Perdido" :
                     t}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── lead_created ── */}
      {data.triggerType === "lead_created" && (
        <LeadCreatedConfig cfg={cfg} updateConfig={updateConfig} />
      )}

      {/* ── stage_changed ── */}
      {data.triggerType === "stage_changed" && (
        <StageChangedConfig cfg={cfg} updateConfig={updateConfig} />
      )}

      {/* ── tag_added ── */}
      {data.triggerType === "tag_added" && (
        <div className="space-y-2">
          <Label>Nome da Tag</Label>
          <Input
            value={(cfg.tag_name as string) || ""}
            onChange={(e) => updateConfig({ tag_name: e.target.value })}
            placeholder="Ex: quente"
          />
        </div>
      )}

      {/* ── score_reached ── */}
      {data.triggerType === "score_reached" && (
        <div className="space-y-2">
          <Label>Score mínimo</Label>
          <Input
            type="number"
            value={(cfg.min_score as number) ?? ""}
            onChange={(e) => updateConfig({ min_score: Number(e.target.value) })}
            placeholder="Ex: 50"
          />
        </div>
      )}

      {/* ── cron ── */}
      {data.triggerType === "cron" && (
        <>
          <div className="space-y-2">
            <Label>Expressão Cron</Label>
            <Input
              value={(cfg.cron_expression as string) || ""}
              onChange={(e) => updateConfig({ cron_expression: e.target.value })}
              placeholder="Ex: 0 9 * * 1-5"
            />
            <p className="text-xs text-muted-foreground">
              Formato: minuto hora dia mês dia-da-semana
            </p>
          </div>
          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Input
              value={(cfg.description as string) || ""}
              onChange={(e) => updateConfig({ description: e.target.value })}
              placeholder="Ex: Seg-Sex às 9h"
            />
          </div>
        </>
      )}

      {/* ── lead_replied ── */}
      {data.triggerType === "lead_replied" && (
        <LeadRepliedConfig cfg={cfg} updateConfig={updateConfig} />
      )}

      {/* ── lead_no_reply ── */}
      {data.triggerType === "lead_no_reply" && (
        <>
          <div className="space-y-2">
            <Label>Timeout (horas)</Label>
            <Input
              type="number"
              min={1}
              value={(cfg.timeout_hours as number) ?? ""}
              onChange={(e) => updateConfig({ timeout_hours: Number(e.target.value) })}
              placeholder="Ex: 24"
            />
          </div>
          <div className="space-y-2">
            <Label>Canal</Label>
            <Select
              value={(cfg.channel as string) || "any"}
              onValueChange={(v) => updateConfig({ channel: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer canal</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="meta">Meta (IG/FB)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* ── meeting_confirmed ── */}
      {data.triggerType === "meeting_confirmed" && (
        <div className="space-y-2">
          <Label>Pipe (opcional)</Label>
          <Select
            value={(cfg.pipe_type as string) || "__any__"}
            onValueChange={(v) => updateConfig({ pipe_type: v === "__any__" ? "" : v })}
          >
            <SelectTrigger><SelectValue placeholder="Qualquer pipe" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">Qualquer</SelectItem>
              <SelectItem value="pipe_confirmacao">{nomeConfirmacao}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ── meeting_not_confirmed ── */}
      {data.triggerType === "meeting_not_confirmed" && (
        <div className="space-y-2">
          <Label>Horas antes da reunião</Label>
          <Input
            type="number"
            min={1}
            value={(cfg.hours_before as number) ?? ""}
            onChange={(e) => updateConfig({ hours_before: Number(e.target.value) })}
            placeholder="Ex: 24"
          />
        </div>
      )}

      {/* ── proposal_accepted / proposal_lost ── */}
      {(data.triggerType === "proposal_accepted" || data.triggerType === "proposal_lost") && (
        <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
          Dispara quando uma proposta muda para "{data.triggerType === "proposal_accepted" ? "vendido" : "perdido"}" no pipe de propostas.
        </div>
      )}

      {/* ── followup_overdue ── */}
      {data.triggerType === "followup_overdue" && (
        <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
          Dispara quando um follow-up automático passa do prazo sem ser concluído.
        </div>
      )}

      {/* ── webhook_received ── */}
      {data.triggerType === "webhook_received" && (
        <>
          <div className="space-y-2">
            <Label>Chave do Webhook</Label>
            <Input
              value={(cfg.webhook_key as string) || ""}
              onChange={(e) => updateConfig({ webhook_key: e.target.value })}
              placeholder="Ex: meu-evento-externo"
            />
            <p className="text-xs text-muted-foreground">
              Identificador único para receber eventos via POST
            </p>
          </div>
          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Input
              value={(cfg.description as string) || ""}
              onChange={(e) => updateConfig({ description: e.target.value })}
              placeholder="Ex: Pagamento confirmado no Stripe"
            />
          </div>
        </>
      )}

      {/* ── lead_assigned ── */}
      {data.triggerType === "lead_assigned" && (
        <div className="space-y-2">
          <Label>Tipo de atribuição</Label>
          <Select
            value={(cfg.role as string) || "any"}
            onValueChange={(v) => updateConfig({ role: v })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Qualquer</SelectItem>
              <SelectItem value="sdr">Pré-venda (SDR)</SelectItem>
              <SelectItem value="sale">Vendedor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ── campaign_status_changed ── */}
      {data.triggerType === "campaign_status_changed" && (
        <>
          <CampaignSelectorField
            campaignId={(cfg.campaign_id as string) || ""}
            onSelect={(id) => updateConfig({ campaign_id: id || "" })}
            optional
          />
          <div className="space-y-2">
            <Label>Novo status</Label>
            <Select
              value={(cfg.new_status as string) || "__any__"}
              onValueChange={(v) => updateConfig({ new_status: v === "__any__" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Qualquer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Qualquer</SelectItem>
                <SelectItem value="active">Ativada</SelectItem>
                <SelectItem value="paused">Pausada</SelectItem>
                <SelectItem value="completed">Encerrada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* ── new campaign triggers ── */}
      {["lead_added_to_campaign", "lead_removed_from_campaign",
        "campaign_lead_replied", "campaign_lead_no_reply", "campaign_completed",
      ].includes(data.triggerType) && (
        <>
          <CampaignSelectorField
            campaignId={(cfg.campaign_id as string) || ""}
            onSelect={(id) => updateConfig({ campaign_id: id || "" })}
            optional
          />
          <p className="text-xs text-muted-foreground">
            {data.triggerType === "lead_added_to_campaign" && "Dispara quando um lead é adicionado à campanha."}
            {data.triggerType === "lead_removed_from_campaign" && "Dispara quando um lead é removido da campanha."}
            {data.triggerType === "campaign_lead_replied" && "Dispara quando o lead responde uma mensagem da campanha."}
            {data.triggerType === "campaign_lead_no_reply" && "Dispara quando o timeout de espera de resposta expira sem resposta."}
            {data.triggerType === "campaign_completed" && "Dispara quando o lead chega no último estágio da campanha."}
          </p>
        </>
      )}

      {/* ── scheduled_date ── */}
      {data.triggerType === "scheduled_date" && (
        <ScheduledDateConfig cfg={cfg} updateConfig={updateConfig} />
      )}

      {/* ── field_changed ── */}
      {data.triggerType === "field_changed" && (
        <>
          <div className="space-y-2">
            <Label>Nome do Campo</Label>
            <Input
              value={(cfg.field_name as string) || ""}
              onChange={(e) => updateConfig({ field_name: e.target.value })}
              placeholder="Ex: faturamento, segment, email"
            />
          </div>
          <div className="space-y-2">
            <Label>Valor anterior (opcional)</Label>
            <Input
              value={(cfg.old_value as string) || ""}
              onChange={(e) => updateConfig({ old_value: e.target.value })}
              placeholder="Qualquer valor anterior"
            />
          </div>
          <div className="space-y-2">
            <Label>Novo valor (opcional)</Label>
            <Input
              value={(cfg.new_value as string) || ""}
              onChange={(e) => updateConfig({ new_value: e.target.value })}
              placeholder="Qualquer novo valor"
            />
          </div>
        </>
      )}
      {/* ── deal_won / deal_lost ──
          Sem configuração: são derivados de `stage_changed` pelo PAPEL da etapa
          de destino (ADR-0023 §4/§5). Filtrar por funil aqui seria oferecer um
          controle que o servidor não lê. */}
      {(data.triggerType === "deal_won" || data.triggerType === "deal_lost") && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground">
          Dispara quando um negócio chega à etapa de{" "}
          {data.triggerType === "deal_won" ? "ganho" : "perda"} de qualquer funil.
          O negócio segue para os nós seguintes — as ações de funil agem sobre ele.
        </p>
      )}

      {/* ── deal_created ── */}
      {data.triggerType === "deal_created" && (
        <DealCreatedConfig cfg={cfg} updateConfig={updateConfig} />
      )}
    </div>
  );
}

// ── Sub-componente para deal_created (Negócios) ──

function DealCreatedConfig({
  cfg,
  updateConfig,
}: {
  cfg: Record<string, unknown>;
  updateConfig: (updates: Record<string, unknown>) => void;
}) {
  const { data: members = [] } = useTeamMembers();
  const activeMembers = members.filter((m) => m.is_active);
  const requireLead = cfg.require_lead !== false;

  return (
    <>
      <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
        <div className="space-y-0.5 pr-3">
          <Label className="text-sm">Só negócios com lead</Label>
          <p className="text-xs text-muted-foreground">
            Negócio sem lead vinculado não tem quem receber mensagem, tag ou etapa.
          </p>
        </div>
        <Switch
          checked={requireLead}
          onCheckedChange={(v) => updateConfig({ require_lead: v })}
        />
      </div>

      <div className="space-y-2">
        <Label>Procedência do negócio</Label>
        <Select
          value={(cfg.source as string) || "any"}
          onValueChange={(v) => updateConfig({ source: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Qualquer procedência</SelectItem>
            <SelectItem value="human">Criado por pessoa</SelectItem>
            <SelectItem value="workflow">Criado por automação</SelectItem>
            <SelectItem value="api">Criado pela API</SelectItem>
            <SelectItem value="import">Importação</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Valor mínimo (R$)</Label>
        <Input
          type="number"
          min={0}
          step={0.01}
          value={(cfg.min_value as number) ?? ""}
          onChange={(e) =>
            updateConfig({ min_value: e.target.value === "" ? undefined : Number(e.target.value) })
          }
          placeholder="Vazio = qualquer valor"
        />
      </div>

      <div className="space-y-2">
        <Label>Responsável do negócio</Label>
        <Select
          value={(cfg.filter_owner_id as string) || "__any__"}
          onValueChange={(v) =>
            updateConfig({ filter_owner_id: v === "__any__" ? "" : v })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">Qualquer responsável</SelectItem>
            {activeMembers.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
        Dispara quando um negócio é criado — na tela de Negócios ou pelo nó "Criar Negócio".
        O lead do workflow é o lead vinculado ao negócio.
      </div>
    </>
  );
}

// ── Sub-componente para lead_replied: canal + funis + texto ──
//
// O filtro por funil usa `pipeline_ids` (lista de `pipelines.id`). Um campo só
// dá conta de funil padrão E custom porque a tabela `pipelines` é a união dos
// dois — o funil custom é espelhado nela com o MESMO uuid. Por isso NÃO
// repetimos aqui a dualidade `filter_pipe` (slug) + `filter_pipeline_id` (uuid)
// que o lead_created carrega.

function LeadRepliedConfig({
  cfg,
  updateConfig,
}: {
  cfg: Record<string, unknown>;
  updateConfig: (updates: Record<string, unknown>) => void;
}) {
  const { data: pipelines } = usePipelines();

  const selectedIds = Array.isArray(cfg.pipeline_ids) ? (cfg.pipeline_ids as string[]) : [];

  // Funil desativado some da lista, mas se ele ainda estiver salvo no filtro
  // precisa continuar visível — senão o usuário vê "0 funis" numa automação
  // que na verdade está restrita, e desmarcar vira impossível.
  const visiblePipelines = (pipelines || []).filter(
    (p) => p.is_active || selectedIds.includes(p.id),
  );
  const togglePipeline = (pipelineId: string, checked: boolean) => {
    const next = checked
      ? [...selectedIds, pipelineId]
      : selectedIds.filter((id) => id !== pipelineId);
    updateConfig({ pipeline_ids: next });
  };

  // Lista única: os funis eram separados em "Funis Padrão" e "Funis Custom"
  // por `p.type`. Quem marca um filtro de gatilho escolhe UM funil pelo nome —
  // a espécie dele nunca entrou nessa decisão.
  const renderPipelines = (items: typeof visiblePipelines) => (
    <div className="space-y-1">
      {items.map((p) => (
        <label
          key={p.id}
          className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
        >
          <Checkbox
            checked={selectedIds.includes(p.id)}
            onCheckedChange={(checked) => togglePipeline(p.id, checked === true)}
          />
          {p.name}
          {!p.is_active && (
            <span className="text-xs text-muted-foreground">(desativado)</span>
          )}
        </label>
      ))}
    </div>
  );

  return (
    <>
      <div className="space-y-2">
        <Label>Canal</Label>
        <Select
          value={(cfg.channel as string) || "any"}
          onValueChange={(v) => updateConfig({ channel: v })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Qualquer canal</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="meta">Meta (IG/FB)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Funis (opcional)</Label>
        <p className="text-xs text-muted-foreground">
          Dispara só quando o lead estiver em um dos funis marcados. Nenhum
          marcado = qualquer funil.
        </p>
        {visiblePipelines.length > 0 ? (
          <div className="space-y-3 max-h-48 overflow-y-auto rounded-md border p-3">
            {renderPipelines(visiblePipelines)}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum funil encontrado.</p>
        )}
        {selectedIds.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {selectedIds.length} funil(is) selecionado(s)
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Contém texto (opcional)</Label>
        <Input
          value={(cfg.contains_text as string) || ""}
          onChange={(e) => updateConfig({ contains_text: e.target.value })}
          placeholder="Ex: confirmo, sim"
        />
        <p className="text-xs text-muted-foreground">
          Refina ainda mais: além do funil, a resposta precisa conter este texto.
        </p>
      </div>
    </>
  );
}

// ── Sub-componente para lead_created com suporte a funis custom ──

function LeadCreatedConfig({
  cfg,
  updateConfig,
}: {
  cfg: Record<string, unknown>;
  updateConfig: (updates: Record<string, unknown>) => void;
}) {
  const { data: customPipelines } = useCustomPipelines();
  // Funis de sistema REAIS da org com o nome que ELA usa (SCRUM-641);
  // value segue o sentinel legado `pipe_<type>` (contrato do executor).
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const opcoesDePipe = destinosDeSistema(displayConfigs).map((d) => ({
    value: `pipe_${d.pipeType}`,
    label: d.label,
  }));
  const { origins: leadOrigins } = useLeadOrigins();

  // Catálogo dinâmico de origens (built-ins globais + custom da org, via lead_origins).
  // Garante que o valor já salvo continue selecionável mesmo se a origem sumiu do
  // catálogo (senão o Select fica vazio).
  const filterOrigin = (cfg.filter_origin as string) || "";
  const originItems = leadOrigins.map((o) => ({ value: o.slug, label: o.label }));
  if (filterOrigin && !originItems.some((o) => o.value === filterOrigin)) {
    originItems.unshift({ value: filterOrigin, label: filterOrigin });
  }

  const filterPipe = (cfg.filter_pipe as string) || "";
  const filterPipelineId = (cfg.filter_pipeline_id as string) || "";

  const currentPipeValue = filterPipelineId || filterPipe || "__any__";

  const handlePipeChange = (value: string) => {
    if (value === "__any__") {
      updateConfig({ filter_pipe: "", filter_pipeline_id: "" });
    } else if (customPipelines?.some((p) => p.id === value)) {
      updateConfig({ filter_pipe: "", filter_pipeline_id: value });
    } else {
      updateConfig({ filter_pipe: value, filter_pipeline_id: "" });
    }
  };

  return (
    <>
      <div className="space-y-2">
        <Label>Filtrar por origem (opcional)</Label>
        <Select
          value={filterOrigin || "__any__"}
          onValueChange={(v) => updateConfig({ filter_origin: v === "__any__" ? "" : v })}
        >
          <SelectTrigger><SelectValue placeholder="Qualquer origem" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">Qualquer origem</SelectItem>
            {originItems.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Filtrar por pipe (opcional)</Label>
        <Select
          value={currentPipeValue}
          onValueChange={handlePipeChange}
        >
          <SelectTrigger><SelectValue placeholder="Qualquer pipe" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__any__">Qualquer pipe</SelectItem>
            <SelectGroup>
              <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                Pipes Padrão
              </SelectLabel>
              {opcoesDePipe.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectGroup>
            {customPipelines && customPipelines.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                  Funis Custom
                </SelectLabel>
                {customPipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>
      {filterPipelineId && (
        <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
          Dispara quando um lead é adicionado a este funil custom.
        </div>
      )}
    </>
  );
}

// ── Sub-componente para stage_changed com carregamento dinâmico de etapas ──

// SCRUM-627: o seletor opera por FUNIL REAL — a lista de `pipelines` da org
// (sistema + custom, um grupo só), gravando sempre `pipeline_id`. O par
// redundante pipe_type/pipeline_id colapsou: `pipe_type` sobrevive só como
// LEITURA legada (config antiga com slug resolve para o funil da org com
// aquele slug), e o fallback silencioso "whatsapp" morreu — sem funil
// escolhido, nenhuma etapa é carregada.
// (SCRUM-618: upsell_* fora — Carteira não é funil, o board dela não escreve
// em pipeline_entries.)
function StageChangedConfig({
  cfg,
  updateConfig,
}: {
  cfg: Record<string, unknown>;
  updateConfig: (updates: Record<string, unknown>) => void;
}) {
  const campanhaId = (cfg.campanha_id as string) || "";
  const selectedStages = (cfg.stages as string[]) || [];
  const isCampaign = !!campanhaId;

  const { data: pipelines } = usePipelines();
  const { data: campanhas } = useCampanhas();

  const legacySlug = (cfg.pipe_type as string) || "";
  const pipelineId =
    ((cfg.pipeline_id as string) || "") ||
    (legacySlug ? pipelines?.find((p) => p.slug === legacySlug)?.id ?? "" : "");

  const funis = (pipelines ?? []).filter((p) => p.is_active !== false);

  const { etapas } = useEtapasDoFunil(!isCampaign && pipelineId ? pipelineId : null);
  const { data: campanhaStages } = useCampanhaStages(
    isCampaign ? campanhaId : undefined
  );

  const stages = isCampaign
    ? (campanhaStages || []).map((s) => ({ key: s.id, name: s.name }))
    : etapas.map((e) => ({ key: e.stageKey, name: e.label }));

  const handlePipeChange = (value: string) => {
    const isCampanhaPipe = campanhas?.some((c) => c.id === value);
    if (isCampanhaPipe) {
      updateConfig({ pipe_type: "", pipeline_id: "", campanha_id: value, stages: [], from_stage: "", to_stage: "" });
    } else {
      // Sempre pipeline_id — funil de sistema incluso. `pipe_type` zera para a
      // config legada não continuar mandando um slug que pode divergir.
      updateConfig({ pipe_type: "", pipeline_id: value, campanha_id: "", stages: [], from_stage: "", to_stage: "" });
    }
  };

  const handleStageToggle = (stageKey: string, checked: boolean) => {
    const current = [...selectedStages];
    if (checked) {
      current.push(stageKey);
    } else {
      const idx = current.indexOf(stageKey);
      if (idx >= 0) current.splice(idx, 1);
    }
    updateConfig({ stages: current });
  };

  const currentPipeValue = isCampaign ? campanhaId : pipelineId || "__none__";

  return (
    <>
      <div className="space-y-2">
        <Label>Pipeline</Label>
        <Select
          value={currentPipeValue}
          onValueChange={handlePipeChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o pipe" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                Funis
              </SelectLabel>
              {funis.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
            {campanhas && campanhas.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                  Campanhas
                </SelectLabel>
                {campanhas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </div>

      {stages.length > 0 && (
        <div className="space-y-2">
          <Label>Etapas (selecione uma ou mais)</Label>
          <p className="text-xs text-muted-foreground">
            Se nenhuma for selecionada, dispara em qualquer etapa deste pipe.
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border p-3">
            {stages.map((s) => (
              <label
                key={s.key}
                className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
              >
                <Checkbox
                  checked={selectedStages.includes(s.key)}
                  onCheckedChange={(checked) =>
                    handleStageToggle(s.key, checked === true)
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
          {selectedStages.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {selectedStages.length} etapa(s) selecionada(s)
            </p>
          )}
        </div>
      )}

      <div className="p-3 rounded-lg bg-muted text-xs text-muted-foreground">
        Este workflow será disparado quando um lead entrar nas etapas selecionadas deste pipe.
      </div>
    </>
  );
}

// ── Sub-componente para scheduled_date ("Antes de uma data") ──
// Alvo = data da reunião marcada de cada lead. Audiência = 1 pipe + etapa(s) + lista de disparos.

// SCRUM-627: mesmo colapso do StageChangedConfig — seletor por funil real
// (`pipelines` da org), gravando `pipeline_id`; `pipe_type` é só leitura
// legada e o fallback silencioso ("confirmacao" aqui) morreu.
function ScheduledDateConfig({
  cfg,
  updateConfig,
}: {
  cfg: Record<string, unknown>;
  updateConfig: (updates: Record<string, unknown>) => void;
}) {
  const selectedStages = (cfg.stages as string[]) || [];
  const dispatches = (cfg.dispatches as ScheduledDispatchItem[]) || [];

  const { data: pipelines } = usePipelines();

  const legacySlug = (cfg.pipe_type as string) || "";
  const pipelineId =
    ((cfg.pipeline_id as string) || "") ||
    (legacySlug ? pipelines?.find((p) => p.slug === legacySlug)?.id ?? "" : "");

  const funis = (pipelines ?? []).filter((p) => p.is_active !== false);

  const { etapas } = useEtapasDoFunil(pipelineId || null);
  const stages = etapas.map((e) => ({ key: e.stageKey, name: e.label }));

  const handlePipeChange = (value: string) => {
    updateConfig({ pipe_type: "", pipeline_id: value, stages: [] });
  };

  const handleStageToggle = (stageKey: string, checked: boolean) => {
    const current = [...selectedStages];
    if (checked) {
      current.push(stageKey);
    } else {
      const idx = current.indexOf(stageKey);
      if (idx >= 0) current.splice(idx, 1);
    }
    updateConfig({ stages: current });
  };

  const updateDispatch = (index: number, patch: Partial<ScheduledDispatchItem>) => {
    const next = dispatches.map((d, i) => (i === index ? { ...d, ...patch } : d));
    updateConfig({ dispatches: next });
  };

  const addDispatch = () => {
    const next: ScheduledDispatchItem[] = [
      ...dispatches,
      { anchor: "antes_da_reuniao", value: 1, unit: "days", send_time: "09:00" },
    ];
    updateConfig({ dispatches: next });
  };

  const removeDispatch = (index: number) => {
    updateConfig({ dispatches: dispatches.filter((_, i) => i !== index) });
  };

  const currentPipeValue = pipelineId || "__none__";

  return (
    <>
      <div className="space-y-2">
        <Label>Pipeline</Label>
        <Select value={currentPipeValue} onValueChange={handlePipeChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione o pipe" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase">
                Funis
              </SelectLabel>
              {funis.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {stages.length > 0 && (
        <div className="space-y-2">
          <Label>Etapas (selecione uma ou mais)</Label>
          <p className="text-xs text-muted-foreground">
            Só leads nessas etapas, com reunião marcada, recebem. Vazio = qualquer etapa.
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border p-3">
            {stages.map((s) => (
              <label
                key={s.key}
                className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
              >
                <Checkbox
                  checked={selectedStages.includes(s.key)}
                  onCheckedChange={(checked) => handleStageToggle(s.key, checked === true)}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Disparos</Label>
        <p className="text-xs text-muted-foreground">
          Cada disparo envia uma vez por lead, antes da reunião marcada dele.
        </p>
        <div className="space-y-2">
          {dispatches.map((d, i) => (
            <div key={i} className="flex items-end gap-2 rounded-md border p-2">
              <div className="space-y-1">
                <Label className="text-xs">Dias antes</Label>
                <Input
                  type="number"
                  min={0}
                  className="w-20"
                  value={d.anchor === "antes_da_reuniao" ? (d.value ?? "") : ""}
                  onChange={(e) =>
                    updateDispatch(i, { value: Number(e.target.value), unit: "days" })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Às</Label>
                <Input
                  type="time"
                  className="w-28"
                  value={d.send_time || "09:00"}
                  onChange={(e) => updateDispatch(i, { send_time: e.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto text-muted-foreground hover:text-destructive"
                onClick={() => removeDispatch(i)}
                aria-label="Remover disparo"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addDispatch} className="w-full">
          <Plus className="h-4 w-4 mr-1" /> Adicionar disparo
        </Button>
      </div>
    </>
  );
}
