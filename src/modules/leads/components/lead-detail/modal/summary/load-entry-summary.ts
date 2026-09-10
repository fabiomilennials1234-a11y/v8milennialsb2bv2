import { supabase } from "@/integrations/supabase/client";
import { contaDoNegocio } from "../../../deal-card/conta-do-negocio";
import {
  montarReuniaoDoNegocio,
  situacaoDaReuniao,
} from "../../../deal-card/reuniao-do-negocio";
import {
  summaryDate,
  summaryField,
  summaryMoney,
  summaryPages,
  type SummarySection,
} from "./format-summary";

/** Mirrors the current business card, scoped to the position actually opened. */
export async function loadEntrySummary(
  entryId: string,
  leadId: string,
  organizationId: string,
): Promise<SummarySection[]> {
  const readEntry = () =>
    supabase
      .from("pipeline_entries")
      .select("*")
      .eq("id", entryId)
      .eq("lead_id", leadId)
      .eq("organization_id", organizationId)
      .single();
  const { data: entry, error } = await readEntry();
  if (error || !entry)
    throw new Error("Negócio indisponível ou sem permissão de acesso.");
  const [
    dealResult,
    items,
    meetings,
    moves,
    stages,
    pipelines,
    members,
    tasks,
    activities,
  ] = await Promise.all([
    entry.deal_id
      ? supabase
          .from("deals")
          .select("*")
          .eq("id", entry.deal_id)
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .single()
      : Promise.resolve({ data: null, error: null }),
    entry.deal_id
      ? summaryPages((a, b) =>
          supabase
            .from("deal_items")
            .select("*")
            .eq("deal_id", entry.deal_id!)
            .eq("organization_id", organizationId)
            .order("sort_order")
            .order("created_at")
            .order("id")
            .range(a, b),
        )
      : Promise.resolve([]),
    entry.deal_id
      ? summaryPages((a, b) =>
          supabase
            .from("meetings")
            .select("id, start_at, status, meet_link")
            .eq("deal_id", entry.deal_id!)
            .eq("organization_id", organizationId)
            .eq("event_type", "meeting")
            .order("start_at")
            .order("id")
            .range(a, b),
        )
      : Promise.resolve([]),
    summaryPages((a, b) =>
      supabase
        .from("pipeline_stage_events")
        .select("*")
        .eq("entry_id", entryId)
        .eq("organization_id", organizationId)
        .order("occurred_at")
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("pipeline_stages")
        .select("id, pipeline_id, stage_key, name, stage_role")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("pipelines")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("team_members")
        .select("id, user_id, name")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("follow_ups")
        .select("id, title, description, due_date, completed_at")
        .eq("pipeline_entry_id", entryId)
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("due_date")
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("activities")
        .select("id, subject, description, due_date, completed_at, outcome")
        .eq("lead_id", leadId)
        .eq("organization_id", organizationId)
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
  ]);
  if (dealResult.error) throw dealResult.error;
  const deal = dealResult.data;
  const metadata =
    entry.metadata &&
    typeof entry.metadata === "object" &&
    !Array.isArray(entry.metadata)
      ? entry.metadata
      : {};
  const stage = (pipelineId: string, key: string | null) =>
    stages.find(
      (s) =>
        s.pipeline_id === pipelineId && (s.stage_key === key || s.id === key),
    );
  const currentStage = stage(entry.pipeline_id, entry.stage_key);
  const currency = deal?.currency ?? "BRL";
  const money = (value: number) => summaryMoney(value, currency);
  const total = contaDoNegocio(
    items.map((i) => ({
      id: i.id,
      nome: i.product_name,
      quantidade: i.quantity,
      precoUnitario: i.unit_price,
      total: i.total ?? 0,
      produtoId: i.product_id,
      descontoPercent: i.discount_percent,
      ordem: i.sort_order,
    })),
    deal?.value ?? null,
    Number(metadata.sale_value) || 0,
  );
  const meeting = montarReuniaoDoNegocio(metadata, meetings);
  const outcome = deal?.outcome ?? currentStage?.stage_role ?? "open";
  const after = await readEntry();
  if (after.error || !after.data || after.data.updated_at !== entry.updated_at)
    throw new Error("Dados do negócio mudaram. Copie novamente.");
  if (deal) {
    const latest = await supabase
      .from("deals")
      .select("updated_at")
      .eq("id", deal.id)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .single();
    if (latest.error || latest.data?.updated_at !== deal.updated_at)
      throw new Error("Dados do negócio mudaram. Copie novamente.");
  }
  return [
    {
      title: "NEGÓCIO",
      lines: [
        summaryField(
          "Nome",
          deal?.title ??
            `Negócio de ${new Date(entry.entered_at ?? entry.created_at).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}`,
        ),
        summaryField(
          "Funil",
          pipelines.find((p) => p.id === entry.pipeline_id)?.name ??
            "Indisponível",
        ),
        summaryField("Estágio", currentStage?.name ?? "Estágio indisponível"),
        summaryField(
          "Situação",
          outcome === "won"
            ? "Ganho"
            : outcome === "lost"
              ? "Perdido"
              : "Aberto",
        ),
        summaryField(
          "Criado em",
          summaryDate(deal?.created_at ?? entry.entered_at ?? entry.created_at),
        ),
        summaryField(
          "Probabilidade",
          deal?.probability != null ? `${deal.probability}%` : null,
        ),
        summaryField(
          "Previsão de fechamento",
          summaryDate(deal?.expected_close_date ?? null),
        ),
        summaryField("Fechado em", summaryDate(deal?.closed_at ?? null)),
        summaryField("Motivo da perda", deal?.loss_reason),
        summaryField("Anotação do negócio", entry.notes),
      ],
    },
    {
      title: "PRODUTOS E VALORES DO NEGÓCIO",
      lines: [
        ...items.map(
          (i) =>
            `• ${i.product_name} — ${i.quantity} un. × ${money(i.unit_price)} — Desconto: ${i.discount_percent}% — Total: ${money(i.total ?? 0)}`,
        ),
        summaryField("Desconto total", money(total.desconto)),
        summaryField("Valor total", money(total.total)),
      ],
    },
    {
      title: "REUNIÃO DO NEGÓCIO",
      lines: meeting
        ? [
            summaryDate(meeting.data),
            summaryField("Situação", situacaoDaReuniao(meeting).rotulo),
            summaryField("Confirmada", meeting.confirmada),
            summaryField("Link", meeting.link),
          ]
        : [],
    },
    {
      title: "MOVIMENTAÇÕES DO NEGÓCIO",
      lines: moves.map((m) => {
        const snapshot = m as typeof m & {
          from_stage_name?: string | null;
          to_stage_name?: string | null;
          actor_name?: string | null;
          from_pipeline_name?: string | null;
          to_pipeline_name?: string | null;
        };
        const from =
          snapshot.from_stage_name ??
          stage(m.pipeline_id, m.from_stage_key)?.name ??
          m.from_stage_key ??
          "Entrada";
        const to =
          snapshot.to_stage_name ??
          stage(m.pipeline_id, m.to_stage_key)?.name ??
          m.to_stage_key;
        const pipeline =
          snapshot.from_pipeline_name && snapshot.to_pipeline_name
            ? `${snapshot.from_pipeline_name} → ${snapshot.to_pipeline_name}`
            : (pipelines.find((p) => p.id === m.pipeline_id)?.name ??
              "Funil indisponível");
        return `${summaryDate(m.occurred_at)} — ${pipeline}: ${from} → ${to} — ${snapshot.actor_name ?? members.find((u) => u.user_id === m.actor || u.id === m.actor)?.name ?? m.source}`;
      }),
    },
    {
      title: "TAREFAS DO NEGÓCIO",
      lines: tasks.map(
        (t) =>
          `${t.completed_at ? "[x]" : "[ ]"} ${t.title}${t.due_date ? ` — ${summaryDate(t.due_date)}` : ""}${t.description ? `\n${t.description}` : ""}`,
      ),
    },
    {
      title: "ATIVIDADES DA PESSOA",
      lines: activities.map(
        (a) =>
          `${a.completed_at ? "[x]" : "[ ]"} ${a.subject}${a.due_date ? ` — ${summaryDate(a.due_date)}` : ""}${a.description ? `\n${a.description}` : ""}${a.outcome ? `\nResultado: ${a.outcome}` : ""}`,
      ),
    },
  ];
}
