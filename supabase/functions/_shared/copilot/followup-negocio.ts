/**
 * Filtro de funil/etapa das regras de follow-up do Copilot, lendo o NEGÓCIO.
 *
 * ADR-0023 §10. Antes, o funil WhatsApp entrava neste filtro pela coluna
 * `leads.pipe_whatsapp` — espelho legado. Quando o negócio sai de Qualificação
 * por MOVE, o gatilho resolve o slug por `NEW.pipeline_id` e não reescreve a
 * coluna: ela CONGELA na última etapa de whatsapp que o lead ocupou. Uma regra
 * com `filter_stages = ['agendado']` continuaria pescando o lead depois de ele
 * já ter virado proposta, e uma com `filter_pipes = ['whatsapp']` continuaria
 * achando que ele está lá. O disparo em lote não erra alto: ele manda a
 * mensagem errada para a pessoa certa, e isso só aparece na conversa.
 *
 * Este módulo existe porque a decisão morava solta dentro do `Deno.serve` de
 * `process-copilot-followups/index.ts`, sem costura — e a mesma leitura estava
 * escrita DUAS vezes (uma no bloco de `filter_pipes`, outra no de
 * `filter_stages`), com chance de as duas divergirem numa edição futura.
 */

/** Linha achatada que `getPipeEntriesByLeads` devolve (uma por lead). */
export interface EntryEmLote {
  lead_id: string;
  stage_key: string;
}

/** Forma que os filtros consomem — `status` é o `stage_key` do Negócio. */
export interface EtapaDoNegocio {
  status: string;
}

/**
 * Cola no lead a etapa do Negócio de cada funil do sistema.
 *
 * As três listas vêm de `getPipeEntriesByLeads`, que já achata N→1 por
 * `pickActiveEntry` (aberta ganha; todas fechadas, a primeira da ordem do SQL).
 * Aqui é só indexação — nenhuma regra de desempate é reimplementada, de
 * propósito: dois lugares desempatando é exatamente como o Copilot e o kanban
 * passam a discordar sobre qual negócio é o corrente.
 *
 * `pipe_confirmacao` / `pipe_propostas` saem como ARRAY porque é o formato que
 * o restante do handler (elegibilidade de trigger) já consome; `whatsapp` sai
 * como objeto simples e com outro nome (`pipe_whatsapp_entry`) para não ser
 * confundido com a coluna espelho homônima.
 */
export function anexarNegocios<T extends { id: string }>(
  leads: T[],
  lote: {
    whatsapp: EntryEmLote[];
    confirmacao: EntryEmLote[];
    propostas: EntryEmLote[];
  },
): (T & {
  pipe_whatsapp_entry: EtapaDoNegocio | null;
  pipe_confirmacao: EtapaDoNegocio[];
  pipe_propostas: EtapaDoNegocio[];
})[] {
  const indexar = (entries: EntryEmLote[]) =>
    new Map(entries.map((e) => [e.lead_id, { status: e.stage_key }]));

  const wa = indexar(lote.whatsapp);
  const conf = indexar(lote.confirmacao);
  const prop = indexar(lote.propostas);

  return leads.map((l) => {
    const c = conf.get(l.id);
    const p = prop.get(l.id);
    return {
      ...l,
      pipe_whatsapp_entry: wa.get(l.id) ?? null,
      pipe_confirmacao: c ? [c] : [],
      pipe_propostas: p ? [p] : [],
    };
  });
}

// deno-lint-ignore no-explicit-any
type LeadDoLote = any;

/** `x?.[0] || x || null` — o array vazio vira `[]`, cujo `.status` é undefined. */
function primeiro(v: unknown): LeadDoLote {
  // deno-lint-ignore no-explicit-any
  return (v as any)?.[0] || v || null;
}

/**
 * Em quais funis o lead está, do ponto de vista do filtro da regra.
 *
 * `whatsapp` sai do NEGÓCIO (`pipe_whatsapp_entry`), nunca da coluna espelho.
 * Os demais (upsell, campanha) não têm Negócio e seguem nas tabelas próprias.
 */
export function funisDoLead(lead: LeadDoLote): string[] {
  const upsell = primeiro(lead?.upsell_clients);
  const confirmacao = primeiro(lead?.pipe_confirmacao);
  const propostas = primeiro(lead?.pipe_propostas);
  const campanha = primeiro(lead?.campanha_leads);

  const funis: string[] = [];
  if (lead?.pipe_whatsapp_entry?.status) funis.push("whatsapp");
  if (upsell?.tipo_cliente_tempo) funis.push("upsell_base");
  if (upsell?.gestao_stage) funis.push("upsell_gestao");
  if (confirmacao?.status) funis.push("confirmacao");
  if (propostas?.status) funis.push("propostas");
  if (campanha) funis.push("campanha");
  return funis;
}

/**
 * Em quais etapas o lead está, somando todos os funis.
 *
 * A etapa de whatsapp é a do Negócio. Vazio é descartado para que
 * `filter_stages = ['']` (regra salva com campo em branco) não case com todo
 * mundo por acidente.
 */
export function etapasDoLead(lead: LeadDoLote): string[] {
  const upsell = primeiro(lead?.upsell_clients);
  const confirmacao = primeiro(lead?.pipe_confirmacao);
  const propostas = primeiro(lead?.pipe_propostas);
  const campanha = primeiro(lead?.campanha_leads);

  return [
    lead?.pipe_whatsapp_entry?.status || "",
    upsell?.tipo_cliente_tempo || "",
    upsell?.gestao_stage || "",
    confirmacao?.status || "",
    propostas?.status || "",
    campanha?.campanha_stages?.name || "",
  ].filter(Boolean);
}

/**
 * Regra SEM filtro não exclui ninguém — o lead passa.
 *
 * O `length === 0` está aqui, e não no chamador, porque é a fronteira que
 * decide entre "esta regra vale para todo o funil" e "esta regra não dispara
 * para ninguém". Invertê-la silencia ou multiplica um disparo em massa.
 */
export function passaFiltroDeFunil(lead: LeadDoLote, filtro: string[]): boolean {
  if (filtro.length === 0) return true;
  const funis = funisDoLead(lead);
  return filtro.some((f) => funis.includes(f));
}

export function passaFiltroDeEtapa(lead: LeadDoLote, filtro: string[]): boolean {
  if (filtro.length === 0) return true;
  const etapas = etapasDoLead(lead);
  return filtro.some((f) => etapas.includes(f));
}
