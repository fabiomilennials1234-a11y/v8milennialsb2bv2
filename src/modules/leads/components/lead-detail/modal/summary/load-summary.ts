import { loadEntrySummary } from "./load-entry-summary";
import { supabase } from "@/integrations/supabase/client";
import {
  LEAD_INFO_FIELDS,
  LEAD_TRACKING_FIELDS,
} from "../body/info-field-config";
import { QUALIFICATION_TIER_CONFIG } from "../qualification-config";
import { ORIGIN_COLORS } from "../../../../lib/origin-config";
import {
  formatSummary,
  summaryDate,
  summaryField,
  summaryMoney,
  summaryPages,
  hasValue,
} from "./format-summary";

/** All reads run as the signed-in user, through RLS. Child tables without an
 * organization_id are scoped to parent IDs obtained from tenant-filtered reads. */
export async function loadLeadSummary(
  leadId: string,
  organizationId: string,
  entryId: string,
): Promise<string> {
  const readLead = () =>
    supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("organization_id", organizationId)
      .single();
  const { data: lead, error } = await readLead();
  if (error || !lead)
    throw new Error("Negócio indisponível ou sem permissão de acesso.");

  const [
    members,
    tags,
    fields,
    comments,
    history,
    entries,
    pipelines,
    stages,
    checklists,
  ] = await Promise.all([
    summaryPages((a, b) =>
      supabase
        .from("team_members")
        .select("id, name, user_id")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("lead_tags")
        .select("id, tag:tags(name)")
        .eq("lead_id", leadId)
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("lead_custom_field_values")
        .select(
          "id, value, field:lead_custom_fields!inner(field_name, field_type, display_order, organization_id)",
        )
        .eq("lead_id", leadId)
        .eq("field.organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("lead_comments")
        .select("*")
        .eq("lead_id", leadId)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("lead_history")
        .select("id, action, description, created_at, created_by, source")
        .eq("lead_id", leadId)
        .eq("organization_id", organizationId)
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("pipeline_entries")
        .select("id, pipeline_id, stage_key")
        .eq("lead_id", leadId)
        .eq("organization_id", organizationId)
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("pipelines")
        .select("id, slug, name, type")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("pipeline_stages")
        .select("id, pipeline_id, pipeline_type, stage_key, name")
        .eq("organization_id", organizationId)
        .order("id")
        .range(a, b),
    ),
    summaryPages((a, b) =>
      supabase
        .from("checklists")
        .select("id, title, pipeline_entry_id")
        .eq("lead_id", leadId)
        .eq("organization_id", organizationId)
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
  ]);
  const lists = await Promise.all(
    checklists
      .filter(
        (list) =>
          !entryId ||
          !list.pipeline_entry_id ||
          list.pipeline_entry_id === entryId,
      )
      .map(async (list) => ({
        ...list,
        items: await summaryPages((a, b) =>
          supabase
            .from("checklist_items")
            .select("id, title, is_completed")
            .eq("checklist_id", list.id)
            .order("position")
            .order("id")
            .range(a, b),
        ),
      })),
  );
  // Do not export data gathered while the lead was deleted or access revoked.
  const entrySections = await loadEntrySummary(entryId, leadId, organizationId);
  const access = await readLead();
  if (access.error || !access.data)
    throw new Error("Acesso ao negócio alterado. Abra o card novamente.");
  if (access.data.updated_at !== lead.updated_at)
    throw new Error("Dados do card mudaram. Copie o resumo novamente.");
  const member = (id: string | null) =>
    id
      ? (members.find((m) => m.id === id)?.name ?? "Indisponível")
      : "Não definido";
  const tier = (value: typeof lead.qualification_tier) =>
    value ? QUALIFICATION_TIER_CONFIG[value].label : "Não definido";
  const record = lead as Record<string, unknown>;
  return formatSummary([
    ...entrySections,
    {
      title: "IDENTIFICAÇÃO E DADOS",
      lines: [
        ...LEAD_INFO_FIELDS.map((f) =>
          summaryField(
            f.label,
            f.type === "currency" &&
              hasValue(record[f.key]) &&
              Number.isFinite(Number(record[f.key]))
              ? summaryMoney(Number(record[f.key]))
              : record[f.key],
          ),
        ),
        summaryField("Criado em", summaryDate(lead.created_at)),
        summaryField(
          "Tags",
          tags
            .map((t) => t.tag?.name)
            .filter(Boolean)
            .sort()
            .join(", "),
        ),
      ],
    },
    {
      title: "RESPONSÁVEIS",
      lines: [
        summaryField("Pré-venda", member(lead.pre_sale_responsible_id)),
        summaryField("Venda", member(lead.sale_responsible_id)),
      ],
    },
    {
      title: "QUALIFICAÇÕES",
      lines: [
        summaryField("Pré-qualificação", tier(lead.pre_qualification_tier)),
        summaryField("Qualificação", tier(lead.qualification_tier)),
      ],
    },
    {
      title: "PIPELINES",
      lines: [
        ...entries
          .filter((entry) => !entryId || entry.id === entryId)
          .map((entry) => {
            const pipe = pipelines.find((p) => p.id === entry.pipeline_id);
            const custom = stages.find(
              (s) =>
                s.pipeline_id === entry.pipeline_id &&
                (s.stage_key === entry.stage_key || s.id === entry.stage_key),
            );
            return `${pipe?.name ?? "Pipeline indisponível"}: ${custom?.name ?? "Estágio indisponível"}`;
          }),
      ],
    },
    {
      title: "CAMPOS PERSONALIZADOS",
      lines: fields
        .sort(
          (a, b) =>
            (a.field?.display_order ?? 0) - (b.field?.display_order ?? 0),
        )
        .map(({ field, value }) => {
          if (!field || !hasValue(value)) return "";
          const formatted =
            field.field_type === "boolean"
              ? value === "true"
                ? "Sim"
                : "Não"
              : field.field_type === "date"
                ? summaryDate(value)
                : value;
          return summaryField(field.field_name, formatted);
        }),
    },
    {
      title: "COMENTÁRIOS",
      lines: comments.map(
        (c) =>
          `${summaryDate(c.created_at)} — ${member(c.author_team_member_id)}${entryId && c.pipeline_entry_id && c.pipeline_entry_id !== entryId ? " (Comentário de outro negócio)" : ""}:\n${c.body}${(c as typeof c & { attachments?: { name: string }[] }).attachments?.map((a) => `\nAnexo: ${a.name}`).join("") ?? ""}`,
      ),
    },
    {
      title: "CHECKLISTS",
      lines: lists.flatMap((list) => [
        list.title,
        ...list.items.map(
          (i) => `${i.is_completed ? "[x]" : "[ ]"} ${i.title}`,
        ),
      ]),
    },
    {
      title: "ORIGEM E RASTREAMENTO",
      lines: LEAD_TRACKING_FIELDS.map((f) =>
        summaryField(
          f.label,
          f.key === "origin" && lead.origin
            ? (ORIGIN_COLORS[lead.origin]?.label ?? lead.origin)
            : record[f.key],
        ),
      ),
    },
    {
      title: "HISTÓRICO",
      lines: history
        .filter((h) => !["comment_added", "comment_deleted"].includes(h.action))
        .map(
          (h) =>
            `${summaryDate(h.created_at)} — ${members.find((m) => m.user_id === h.created_by || m.id === h.created_by)?.name ?? h.source}: ${h.description ?? h.action}`,
        ),
    },
  ]);
}
