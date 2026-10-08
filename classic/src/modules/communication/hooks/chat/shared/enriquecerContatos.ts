import { enrichSavedContactNames } from "./savedContactNames";
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
  type ChunkedResult,
} from "@/shared/supabase/selectInChunks";
import type { ChatContact, ChatContactTag } from "../types";
import { normalizarTelefoneBr } from "../../../lib/normalizarTelefoneBr";

/**
 * A linha do join de etiqueta, dos dois lados.
 *
 * `tags!inner(...)` devolve o objeto embutido, e não um array, porque o join é
 * para UM. Tipar aqui é o que permite ler `row.tags.id` sem `any` — e faz uma
 * coluna renomeada aparecer no compilador em vez de virar `undefined` na
 * etiqueta em branco.
 *
 * ⚠️ O builder do postgrest-js não é atribuível a esta forma sem um passo
 * explícito: ele tipa o embed como união de objeto e array, porque não sabe que
 * o join é para UM. O `as unknown as` nas duas chamadas é esse passo, e é mais
 * estreito que o `any` que estava aqui antes — a forma fica declarada num lugar
 * só, e coluna renomeada volta a aparecer no compilador.
 */
interface LinhaDeEtiqueta {
  lead_id?: string;
  conversation_id?: string;
  tags: ChatContactTag;
}

/** Pares por chamada de `contatos_das_conversas` — o teto da RPC. */
const PARES_POR_CHAMADA = 500;

/**
 * Nome do contato (`lead_phones.label`) do telefone de CADA conversa — Chamado
 * 82c50502. Uma chamada por página (em lotes de 500 pares), nunca uma por
 * conversa. Só WhatsApp, não grupo, com lead.
 */
async function buscarContatosDasConversas(
  contatos: ChatContact[],
): Promise<Map<string, string>> {
  const pares = contatos
    .filter((c) => c.channel === "whatsapp" && !c.is_group && c.lead_id && c.phone_number)
    .map((c) => ({ lead_id: c.lead_id as string, phone: c.phone_number }));
  const porChave = new Map<string, string>();
  for (let i = 0; i < pares.length; i += PARES_POR_CHAMADA) {
    const { data, error } = await supabase.rpc("contatos_das_conversas", {
      p_pairs: pares.slice(i, i + PARES_POR_CHAMADA),
    });
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ lead_id: string; normalized_phone: string; label: string | null }>) {
      if (row.label) porChave.set(`${row.lead_id}:${row.normalized_phone}`, row.label);
    }
  }
  return porChave;
}

export interface OpcoesDeEnriquecimento {
  /**
   * O filtro do inbox está recortando por etiqueta. Quando `true`, a falha do
   * fetch de etiquetas sobe em vez de virar lista vazia.
   */
  tagsCriticas: boolean;
  organizationId?: string;
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
  { tagsCriticas, organizationId }: OpcoesDeEnriquecimento,
): Promise<ChatContact[]> {
  if (contatos.length === 0) return contatos;
  if (organizationId) await enrichSavedContactNames(contatos, organizationId);

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

  const [leadNameRows, leadTagRows, convTagRows, contatosDasConversas] = await Promise.all([
    soft(
      selectInChunks<{ id: string; name: string | null; erp_code: string | null }>(
        leadIds,
        (chunk) => supabase.from("leads").select("id, name, erp_code").in("id", chunk),
        IN_CHUNK_SIZE,
      ),
      "leads",
    ),
    softTags(
      selectInChunks<LinhaDeEtiqueta>(
        leadIds,
        (chunk) =>
          supabase
            .from("lead_tags")
            .select("lead_id, tags!inner(id, name, color)")
            .in("lead_id", chunk) as unknown as PromiseLike<
            ChunkedResult<LinhaDeEtiqueta>
          >,
        IN_CHUNK_SIZE_FANOUT,
      ),
      "lead_tags",
    ),
    softTags(
      selectInChunks<LinhaDeEtiqueta>(
        convIds,
        (chunk) =>
          supabase
            .from("whatsapp_conversation_tags")
            .select("conversation_id, tags!inner(id, name, color)")
            .in("conversation_id", chunk) as unknown as PromiseLike<
            ChunkedResult<LinhaDeEtiqueta>
          >,
        IN_CHUNK_SIZE_FANOUT,
      ),
      "conversation_tags",
    ),
    // Acessório como o nome: falha vira "sem contato" e o nome cai em "Cód - Lead".
    buscarContatosDasConversas(contatos).catch((e) => {
      console.error('[inbox] enriquecimento "contatos_das_conversas" falhou', e);
      return new Map<string, string>();
    }),
  ]);

  const leadNameMap = new Map<string, string>();
  const leadErpCodeMap = new Map<string, string>();
  for (const row of leadNameRows) {
    if (row.name) leadNameMap.set(row.id, row.name);
    if (row.erp_code) leadErpCodeMap.set(row.id, row.erp_code);
  }

  const leadTagsMap = new Map<string, ChatContactTag[]>();
  for (const row of leadTagRows) {
    if (!row.lead_id || !row.tags) continue;
    leadTagsMap.set(row.lead_id, [...(leadTagsMap.get(row.lead_id) || []), row.tags]);
  }

  const convTagsMap = new Map<string, ChatContactTag[]>();
  for (const row of convTagRows) {
    if (!row.conversation_id || !row.tags) continue;
    convTagsMap.set(row.conversation_id, [
      ...(convTagsMap.get(row.conversation_id) || []),
      row.tags,
    ]);
  }

  for (const c of contatos) {
    if (c.lead_id) {
      c.lead_name = leadNameMap.get(c.lead_id) ?? null;
      c.lead_erp_code = leadErpCodeMap.get(c.lead_id) ?? null;
      c.lead_contact_label = c.phone_number
        ? contatosDasConversas.get(`${c.lead_id}:${normalizarTelefoneBr(c.phone_number)}`) ?? null
        : null;
    }
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
