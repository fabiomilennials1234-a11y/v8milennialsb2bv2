/**
 * notificame-reacoes — o que um evento de entrada merece disparar. PURO.
 *
 * ─── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * O segundo nó mais executado do produto é o "esperar resposta": 11.653
 * execuções em 7 dias. Ele destrava porque o webhook do chip chama uma RPC
 * quando chega mensagem do cliente. O webhook do NotificaMe não chamava nada, e
 * uma execução que esperasse resposta no canal oficial esperava para sempre —
 * automação de mão única, que envia e fica surda.
 *
 * ─── POR QUE A REGRA MORA FORA DO HANDLER ───────────────────────────────────
 *
 * Porque o eixo do Instagram vai reusá-la, e porque as três decisões perigosas
 * moram aqui: o que conta como resposta do cliente, por qual CHAVE resolver, e
 * quando não fazer nada. Enterradas no handler, elas só seriam exercitadas com
 * banco e rede.
 */

export type DirecaoDoEvento = "incoming" | "outgoing";

export interface EventoParaReagir {
  direcao: DirecaoDoEvento;
  /** O eixo da caixa. Decide qual chave existe. */
  canal: "whatsapp" | "instagram";
  /** Só o canal oficial o tem — no Instagram o interlocutor não é um telefone. */
  telefone: string | null;
  /** Resolvido por vínculo humano. `null` enquanto ninguém vinculou. */
  leadId: string | null;
}

/**
 * Contexto que acompanha o disparo do `lead_replied`.
 *
 * ⚠️ O disparo saía SEM contexto nenhum. Como `matchesTriggerConfig` só compara
 * quando o contexto traz o campo, um workflow restrito a "canal WhatsApp"
 * disparava também com resposta de Instagram: filtro que passa sempre é filtro
 * que não existe. O filtro por número de origem cairia no mesmo buraco.
 *
 * Não há `instance_id` aqui, e é de propósito: o canal oficial não tem Instance
 * de WhatsApp. A ausência faz o matcher reprovar por fail-closed os workflows
 * que filtram por número — que é a resposta certa, e não uma lacuna.
 */
export interface ContextoDoGatilho {
  trigger: "lead_replied";
  /** `meta` é como o seletor da tela chama Instagram e Facebook. */
  channel: "whatsapp" | "meta";
}

export interface ReacoesDoEvento {
  /** Telefone a passar para a RPC que recorta leads por número. */
  resolverEsperaPorTelefone: string | null;
  /** Lead a passar para a variante da RPC que recebe o lead direto. */
  resolverEsperaPorLead: string | null;
  dispararLeadRespondeu: boolean;
  /** `null` quando o evento não dispara nada. */
  contextoDoGatilho: ContextoDoGatilho | null;
}

const NADA: ReacoesDoEvento = {
  resolverEsperaPorTelefone: null,
  resolverEsperaPorLead: null,
  dispararLeadRespondeu: false,
  contextoDoGatilho: null,
};

function textoDe(valor: string | null | undefined): string | null {
  const s = (valor ?? "").trim();
  return s === "" ? null : s;
}

export function reacoesDoEvento(evento: EventoParaReagir): ReacoesDoEvento {
  // ⚠️ SÓ A ENTRADA CONTA. As respostas que o vendedor dá pelo aplicativo do
  // fornecedor entram como `outgoing` — tratá-las como resposta do lead
  // destravaria o workflow com a NOSSA própria mensagem, e o prazo de espera se
  // renovaria sozinho, sempre otimista e sempre errado.
  if (evento.direcao !== "incoming") return NADA;

  // ⚠️ TELEFONE SÓ NO WHATSAPP, e isto não é excesso de zelo. O identificador
  // do Instagram tem 15 a 17 dígitos e `normalize_brazilian_phone` o devolve
  // INTACTO — 16 dígitos entram, 16 saem. Aceitá-lo como telefone o faria casar
  // com `leads.normalized_phone` e, a partir daí, virar alvo de disparo e de
  // busca por número. O canal decide a chave; o campo estar preenchido não basta.
  const telefone = evento.canal === "whatsapp" ? textoDe(evento.telefone) : null;
  const leadId = textoDe(evento.leadId);

  // Sem chave nenhuma não há o que resolver. É o estado de toda conversa de
  // Instagram ainda não vinculada — não é erro, é uma conversa sem dono.
  if (!telefone && !leadId) return NADA;

  return {
    resolverEsperaPorTelefone: telefone,
    resolverEsperaPorLead: telefone ? null : leadId,
    dispararLeadRespondeu: true,
    contextoDoGatilho: {
      trigger: "lead_replied",
      channel: evento.canal === "whatsapp" ? "whatsapp" : "meta",
    },
  };
}
