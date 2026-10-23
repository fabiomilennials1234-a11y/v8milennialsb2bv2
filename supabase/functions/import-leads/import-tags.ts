/**
 * Etiquetas escolhidas no import de planilha.
 *
 * A edge roda com service_role (RLS desligado): um id de etiqueta vindo do
 * cliente só vale depois de provado como etiqueta da org resolvida pelo token.
 * Sem isso, qualquer membro penduraria nos próprios leads a etiqueta de outra org.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_IMPORT_TAGS = 20;

/** Linhas por upsert em `lead_tags` — cada linha inserida dispara `trg_workflow_tag_added`. */
const ROWS_PER_UPSERT = 500;

type DbError = { message: string } | null;
type TagLookup = {
  select(columns: string): {
    eq(column: string, value: string): {
      in(column: string, values: string[]): PromiseLike<{ data: { id: string }[] | null; error: DbError }>;
    };
  };
};
type TagWriter = {
  upsert(
    rows: { lead_id: string; tag_id: string }[],
    options: { onConflict: string; ignoreDuplicates: boolean },
  ): PromiseLike<{ error: DbError }>;
};
type Db = { from(table: string): TagLookup | TagWriter };

export type ResolvedImportTags =
  | { ok: true; tagIds: string[] }
  | { ok: false; error: string };

export interface ImportTagsReport {
  /** Leads que ficaram com todas as etiquetas escolhidas. */
  leads: number;
  /** Leads cujo lote falhou ao gravar — importados, mas sem as etiquetas. */
  failed: number;
}

export async function resolveImportTagIds(
  db: Db,
  organizationId: string,
  raw: unknown,
): Promise<ResolvedImportTags> {
  if (raw === undefined || raw === null) return { ok: true, tagIds: [] };

  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !UUID.test(id))) {
    return { ok: false, error: "tag_ids deve ser uma lista de ids de etiqueta" };
  }

  const tagIds = [...new Set((raw as string[]).map((id) => id.toLowerCase()))];
  if (tagIds.length === 0) return { ok: true, tagIds };
  if (tagIds.length > MAX_IMPORT_TAGS) {
    return { ok: false, error: `Escolha no máximo ${MAX_IMPORT_TAGS} etiquetas por importação` };
  }

  const { data, error } = await (db.from("tags") as TagLookup)
    .select("id")
    .eq("organization_id", organizationId)
    .in("id", tagIds);
  if (error) throw new Error(`Falha ao validar etiquetas: ${error.message}`);

  const daOrg = new Set(((data ?? []) as { id: string }[]).map((t) => t.id.toLowerCase()));
  if (tagIds.some((id) => !daOrg.has(id))) {
    return {
      ok: false,
      error: "Uma das etiquetas escolhidas não existe mais nesta organização. Recarregue a tela e tente de novo.",
    };
  }

  return { ok: true, tagIds };
}

export async function applyImportTags(
  db: Db,
  leadIds: Iterable<string>,
  tagIds: string[],
): Promise<ImportTagsReport> {
  const leads = [...new Set(leadIds)];
  const report: ImportTagsReport = { leads: 0, failed: 0 };
  if (tagIds.length === 0 || leads.length === 0) return report;

  const leadsPerChunk = Math.max(1, Math.floor(ROWS_PER_UPSERT / tagIds.length));

  for (let i = 0; i < leads.length; i += leadsPerChunk) {
    const chunk = leads.slice(i, i + leadsPerChunk);
    const rows = chunk.flatMap((lead_id) => tagIds.map((tag_id) => ({ lead_id, tag_id })));

    // DO NOTHING no conflito: lead que já tinha a etiqueta não é tocado nem
    // re-dispara as automações de "tag adicionada".
    const { error } = await (db.from("lead_tags") as TagWriter)
      .upsert(rows, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });

    if (error) {
      report.failed += chunk.length;
      console.error("[import-leads] etiquetas do lote falharam", {
        leads: chunk.length,
        error: error.message,
      });
    } else {
      report.leads += chunk.length;
    }
  }

  return report;
}
