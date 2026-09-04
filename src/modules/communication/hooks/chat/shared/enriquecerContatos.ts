/**
 * `enriquecerContatos` — nome do lead e etiquetas por cima das linhas que a RPC
 * de lista devolveu.
 *
 * Extraído de `useWhatsAppContacts` quando a caixa unificada passou a ter um
 * SEGUNDO caminho de lista (o conjunto de caixas). Duas cópias deste bloco
 * divergiriam na primeira coluna nova — e a divergência apareceria como conversa
 * sem nome numa tela e com nome na outra, que é indistinguível de dado faltando
 * no banco.
 *
 * ─── POR QUE A FALHA NÃO DEGRADA IGUAL PARA TUDO ────────────────────────────
 *
 * Nome e etiqueta são acessórios: a lista é o payload e sobrevive sem eles. Mas
 * etiqueta é a ÚNICA coisa enriquecida aqui que o filtro do inbox AVALIA
 * (`matchesTags`). Com filtro de etiqueta ativo, devolver `[]` não é degradar: é
 * reprovar a página inteira e mostrar "Total: 0" como se fosse resposta — o
 * incidente da Goletric Pinheiros, 2026-07-31. Então quando a dimensão está em
 * uso a falha SOBE e a query vai a `isError`, para o gate acender o aviso em vez
 * do empty state.
 *
 * ─── POR QUE EM LOTES ───────────────────────────────────────────────────────
 *
 * Com filtro ativo a página vai a 1000 conversas, e um `.in()` com 1000 uuids
 * passa de 39 KB de URL: o gateway responde 400. Antes o código lia só `.data`,
 * sem checar `error`, e esse 400 apagava nome e etiqueta de todas as conversas
 * em silêncio.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  selectInChunks,
  IN_CHUNK_SIZE,
  IN_CHUNK_SIZE_FANOUT,
} from "@/shared/supabase/selectInChunks";
import type { ChatContact, ChatContactTag } from "../types";

export interface OpcoesDeEnriquecimento {
  /**
   * O filtro do inbox está recortando por etiqueta. Quando `true`, a falha do
   * fetch de etiquetas sobe em vez de virar lista vazia.
   */
  tagsCriticas: boolean;
}

/**
 * Preenche `lead_name` e `tags` NO LUGAR e devolve o mesmo array.
 *
 * Mutação e não cópia porque é assim que o chamador original já operava, e o
 * array acabou de ser construído por ele — não há referência de fora para
 * observar o meio do caminho.
 */
export async function enriquecerContatos(
  contatos: ChatContact[],
  { tagsCriticas }: OpcoesDeEnriquecimento,
): Promise<ChatContact[]> {
  if (contatos.length === 0) return contatos;

  // Falha de enriquecimento NÃO derruba a lista. Mas degradar em SILÊNCIO foi o
  // que escondeu o incidente — agora deixa rastro no console.
  const soft = <T,>(p: Promise<T[]>, label: string): Promise<T[]> =>
    p.catch((e) => {
      console.error(`[inbox] enriquecimento "${label}" falhou`, e);
      return [] as T[];
    });
  const softTags = <T,>(p: Promise<T[]>, label: string): Promise<T[]> =>
    tagsCriticas ? p : soft(p, label);

  const leadIds = [
    ...new Set(contatos.map((c) => c.lead_id).filter((id): id is string => !!id)),
  ];
  const convIds = [
    ...new Set(
      contatos.map((c) => c.conversation_id).filter((id): id is string => !!id),
    ),
  ];

  const [leadNameRows, leadTagRows, convTagRows] = await Promise.all([
    soft(
      selectInChunks<{ id: string; name: string | null }>(
        leadIds,
        (chunk) => supabase.from("leads").select("id, name").in("id", chunk),
        IN_CHUNK_SIZE,
      ),
      "leads",
    ),
    softTags(
      selectInChunks<any>(
        leadIds,
        (chunk) =>
          supabase
            .from("lead_tags")
            .select("lead_id, tags!inner(id, name, color)")
            .in("lead_id", chunk),
        IN_CHUNK_SIZE_FANOUT,
      ),
      "lead_tags",
    ),
    softTags(
      selectInChunks<any>(
        convIds,
        (chunk) =>
          supabase
            .from("whatsapp_conversation_tags")
            .select("conversation_id, tags!inner(id, name, color)")
            .in("conversation_id", chunk),
        IN_CHUNK_SIZE_FANOUT,
      ),
      "conversation_tags",
    ),
  ]);

  const leadNameMap = new Map<string, string>();
  for (const row of leadNameRows) if (row.name) leadNameMap.set(row.id, row.name);

  const leadTagsMap = new Map<string, ChatContactTag[]>();
  for (const row of leadTagRows as any[]) {
    const tag = (row as { tags: ChatContactTag }).tags;
    leadTagsMap.set(row.lead_id, [...(leadTagsMap.get(row.lead_id) || []), tag]);
  }

  const convTagsMap = new Map<string, ChatContactTag[]>();
  for (const row of convTagRows as any[]) {
    const tag = (row as { tags: ChatContactTag }).tags;
    convTagsMap.set(row.conversation_id, [
      ...(convTagsMap.get(row.conversation_id) || []),
      tag,
    ]);
  }

  for (const c of contatos) {
    if (c.lead_id) c.lead_name = leadNameMap.get(c.lead_id) ?? null;
    const tagIds = new Set<string>();
    const merged: ChatContactTag[] = [];
    for (const t of (c.lead_id ? leadTagsMap.get(c.lead_id) : undefined) || [])
      if (!tagIds.has(t.id)) {
        tagIds.add(t.id);
        merged.push(t);
      }
    for (const t of (c.conversation_id ? convTagsMap.get(c.conversation_id) : undefined) || [])
      if (!tagIds.has(t.id)) {
        tagIds.add(t.id);
        merged.push(t);
      }
    c.tags = merged;
  }

  return contatos;
}
