/**
 * Texto do relatório de importação: número da linha e motivo da recusa.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

function truncateErr(msg: string | undefined | null, max = 200): string {
  if (!msg) return "erro desconhecido";
  return msg.length <= max ? msg : `${msg.slice(0, max)}…`;
}

/**
 * Número da linha que o relatório mostra. O navegador manda `source_row` (a linha da
 * planilha, cabeçalho = 1); sem ele (outras origens: n8n, API) cai na posição + 1.
 * A posição sozinha erra: não conta o cabeçalho e desliza a cada linha vazia, sem nome
 * ou inválida descartada antes de chegar aqui.
 */
export function reportRow(lead: { source_row?: number }, index: number): number {
  const r = lead.source_row;
  return typeof r === "number" && Number.isInteger(r) && r > 0 ? r : index + 1;
}

/**
 * Motivo legível para o INSERT do lead que falhou. A violação do índice único do
 * telefone vira "já existe" (com o nome de quem segura o número, quando dá para achar);
 * o resto segue como erro truncado.
 */
export async function motivoFalhaDeInsercao(
  supabase: SupabaseClient,
  organizationId: string,
  err: { message?: string; code?: string },
  phone: string | undefined,
): Promise<string> {
  const unique = err.code === "23505" || /idx_leads_org_phone_unique/.test(err.message ?? "");
  if (!unique) return `Erro ao inserir lead: ${truncateErr(err.message)}`;
  try {
    if (phone) {
      // Cliente sem tipos do banco: a assinatura de rpc() chega como `undefined`.
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown }>;
      const { data: norm } = await rpc("normalize_brazilian_phone", { phone });
      if (typeof norm === "string" && norm) {
        const { data: dono } = await supabase
          .from("leads")
          .select("name, company")
          .eq("organization_id", organizationId)
          .eq("normalized_phone", norm)
          .is("deleted_at", null)
          .eq("phone_compartilhado", false)
          .limit(1)
          .maybeSingle();
        const nome = (dono as { name?: string | null; company?: string | null } | null);
        const quem = nome?.company || nome?.name;
        if (quem) return `Já existe um lead com este telefone: "${quem}"`;
      }
    }
  } catch {
    // Só explica; a recusa em si já aconteceu.
  }
  return "Já existe um lead com este telefone";
}
