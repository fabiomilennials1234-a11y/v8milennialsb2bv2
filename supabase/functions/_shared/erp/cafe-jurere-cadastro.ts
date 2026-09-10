import { buildTothCadastro } from "./toth-cadastro.ts";

export interface CadastroTarget {
  id: string;
  external_id: string;
  erp_metadata: Record<string, unknown> | null;
}

/** Apenas os IDs já visíveis fornecidos pelo servidor entram no plano de escrita. */
export function planCadastroVisivel(targets: CadastroTarget[], rows: Record<string, unknown>[]) {
  const byCode = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const code = String(row.codigoCliente ?? "").trim();
    if (!code) continue;
    if (byCode.has(code)) throw new Error("ERP retornou códigos de cliente duplicados; cadastro não atualizado.");
    byCode.set(code, row);
  }
  const updates: Array<{ id: string; erp_metadata: Record<string, unknown> }> = [];
  let missing = 0;
  let unchanged = 0;
  for (const target of targets) {
    const row = byCode.get(target.external_id);
    if (!row) { missing++; continue; }
    const cadastro = buildTothCadastro(row);
    const previous = target.erp_metadata?.cadastro as Record<string, unknown> | undefined;
    // jsonb reordena as chaves; comparar a serialização reescreveria tudo.
    if (previous && Object.keys(previous).length === Object.keys(cadastro).length &&
      Object.entries(cadastro).every(([key, value]) => previous[key] === value)) { unchanged++; continue; }
    updates.push({ id: target.id, erp_metadata: { ...target.erp_metadata, cadastro } });
  }
  return { updates, missing, unchanged };
}
