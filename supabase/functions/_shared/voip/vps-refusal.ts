/**
 * Traduz uma recusa da VPS num código que o CRM sabe explicar ao vendedor.
 *
 * ─── o defeito que isto conserta (issue #1365) ──────────────────────────────
 *
 * A informação existia e morria no último passo:
 *
 *   1. a VPS devolvia `"51985960716: number is not on WhatsApp"`
 *   2. `torquecalls-signal` repassava `{ error, code: "vps_refused" }`
 *   3. o front descartava o `error` e traduzia só o código →
 *      *"O serviço de chamadas recusou a ligação"*
 *
 * O vendedor não tem o que fazer com essa frase. Tenta de novo, dá o mesmo, e
 * conclui que a ferramenta está quebrada. A causa real — o número não tem
 * WhatsApp — ele resolveria em dez segundos corrigindo o cadastro.
 *
 * ─── por que código, e não a prosa ──────────────────────────────────────────
 *
 * A saída óbvia seria mostrar o texto da VPS. Não serve: é texto de terceiro,
 * em inglês, escrito para operador de infraestrutura, e muda quando a
 * biblioteca de baixo muda. Mostrá-lo faria a interface do vendedor depender de
 * uma string que ninguém promete manter.
 *
 * Então a prosa vira um SÍMBOLO aqui, uma vez, e o símbolo é o que atravessa. A
 * tabela de mensagens (`CALL_DENY_MESSAGES`, no front) é a única dona do texto
 * que o humano lê.
 *
 * ─── duas fontes, nesta ordem ───────────────────────────────────────────────
 *
 * 1. `code` — a VPS passou a emitir códigos estáveis (`cmd/server/peerjid.go` e
 *    `httpapi.go`). É a fonte boa e é preferida sempre que existe.
 *
 * 2. a prosa — porque a VPS em produção HOJE ainda não emite `code`, e este
 *    conserto não pode depender de os dois lados subirem juntos. Sem o degrau
 *    de prosa, o vendedor continuaria vendo a frase genérica até o dia do
 *    deploy da VPS; com ele, o conserto vale assim que o CRM subir.
 *
 * O degrau de prosa é dívida com prazo: quando a VPS nova estiver em produção
 * há tempo suficiente, ele sai e o `code` fica sozinho. Está marcado como tal
 * de propósito — é o tipo de fallback que vira permanente por esquecimento.
 */

/**
 * Códigos que esta função pode produzir. São códigos do CRM, não da VPS: alguns
 * reusam nomes que o governor já usa (`operator_busy`, `org_concurrency_reached`)
 * justamente para que a mesma causa tenha um nome só na interface, venha ela do
 * banco ou da rede.
 */
export type VpsRefusalCode =
  /** O WhatsApp respondeu: este número não tem conta. Dado do lead. */
  | "peer_not_on_whatsapp"
  /** Não foi possível PERGUNTAR ao WhatsApp. Transitório — tentar de novo serve. */
  | "whatsapp_unreachable"
  /** O número que saiu do choke não é discável. Defeito nosso. */
  | "invalid_peer"
  /** A sessão existe mas não está pareada com um aparelho. */
  | "session_not_paired"
  /** O operador já está numa chamada, segundo a contagem da VPS. */
  | "operator_busy"
  /** A sessão bateu o teto de chamadas simultâneas da VPS. */
  | "org_concurrency_reached"
  /**
   * A ligação de entrada já tem dono — o celular do vendedor atendeu, ou um
   * colega pegou primeiro pelo CRM.
   *
   * Tem código próprio porque é o desfecho NORMAL da corrida que o ADR-0027
   * desenha de propósito: o celular toca junto, e quem pegar primeiro leva. Sem
   * ele, o vendedor que clicou meio segundo tarde lia "o serviço de chamadas
   * recusou a ligação" — uma frase de falha para uma disputa que ele perdeu, e
   * que o faz abrir chamado sobre um sistema que funcionou.
   */
  | "call_already_claimed"
  /** A VPS não respondeu (timeout ou rede). Distinto de "recusou". */
  | "vps_unreachable"
  /**
   * A chamada não está mais lá para ser atendida — o cliente desistiu, ou ela
   * já foi encerrada. Reusa o nome que o governor (`DenyCode`) já dá à mesma
   * causa: uma causa, um nome na interface, venha ela do banco ou da rede.
   */
  | "call_not_answerable"
  /** Fim de linha: a VPS recusou e não sabemos dizer por quê. */
  | "vps_refused";

/** O que `callVps` devolve quando `ok: false`. */
export interface VpsFailure {
  status: number;
  error: string;
  code?: string;
}

/**
 * Códigos da VPS → códigos do CRM.
 *
 * O mapa é explícito nos dois lados mesmo quando os nomes coincidem. Um
 * `Record` com identidade implícita ("se não achar, repassa") deixaria qualquer
 * código futuro da VPS vazar direto para a tabela de mensagens do front, que
 * não o conhece — e o vendedor veria o fallback, sem ninguém perceber que um
 * código novo apareceu.
 */
const POR_CODIGO: Record<string, VpsRefusalCode> = {
  peer_not_on_whatsapp: "peer_not_on_whatsapp",
  whatsapp_unreachable: "whatsapp_unreachable",
  peer_phone_required: "invalid_peer",
  session_not_paired: "session_not_paired",
  operator_busy: "operator_busy",
  max_concurrent_calls: "org_concurrency_reached",
  call_already_claimed: "call_already_claimed",
};

/**
 * Degrau de compatibilidade: prosa → código, para a VPS que ainda não emite
 * `code`.
 *
 * DÍVIDA COM PRAZO. Sai quando a VPS com códigos estáveis estiver em produção.
 * Cada padrão aqui casa o texto de UMA resposta de `cmd/server/httpapi.go`, e a
 * ordem importa: o primeiro que casar vence.
 */
const POR_PROSA: ReadonlyArray<readonly [RegExp, VpsRefusalCode]> = [
  // `fmt.Errorf("%s: %w", digits, errNotOnWhatsApp)` → "51985960716: number is not on WhatsApp"
  [/number is not on whatsapp/i, "peer_not_on_whatsapp"],
  // `fmt.Errorf("resolving %s: %w", digits, err)` → falha ao falar com o WhatsApp
  [/^resolving\s/i, "whatsapp_unreachable"],
  [/phone required/i, "invalid_peer"],
  [/not paired/i, "session_not_paired"],
  [/operator already on a call/i, "operator_busy"],
  [/max concurrent calls/i, "org_concurrency_reached"],
  // `doAccept` (`cmd/server/httpapi.go`): `setOwner` recusou porque a chamada
  // já tem dono. É a corrida com o celular, e ela é o caminho esperado.
  [/claimed by another client/i, "call_already_claimed"],
  // `doAccept`/`doWebRTC`: a chamada saiu do registro da sessão. Para quem
  // clicou em atender significa a mesma coisa que o de cima — não é mais dele —
  // mas o motivo é outro (o cliente desistiu), e por isso o código é outro.
  [/no such call/i, "call_not_answerable"],
];

/**
 * `callVps` já classifica o que nem chegou à VPS: 504 é timeout, 502 é falha de
 * rede. Os dois são "não respondeu", que é conselho diferente de "recusou" —
 * e não devem ser confundidos com o 502 que a VPS devolve quando ELA não
 * conseguiu falar com o WhatsApp (esse vem com prosa/código e é pego antes).
 */
function semResposta(f: VpsFailure): boolean {
  return f.status === 504 || /^timeout falando com a VPS|^falha de rede:/.test(f.error);
}

/**
 * Decide o código de uma recusa da VPS.
 *
 * Nunca lança e nunca devolve vazio: fim de linha é `vps_refused`, que é
 * exatamente o comportamento de hoje — este conserto só tira causas de dentro
 * daquele balde, uma a uma, sem mudar o que sobra.
 */
export function vpsRefusalCode(failure: VpsFailure): VpsRefusalCode {
  const doCodigo = failure.code ? POR_CODIGO[failure.code] : undefined;
  if (doCodigo) return doCodigo;

  const prosa = failure.error ?? "";
  for (const [padrao, codigo] of POR_PROSA) {
    if (padrao.test(prosa)) return codigo;
  }

  if (semResposta(failure)) return "vps_unreachable";

  return "vps_refused";
}

/**
 * Como uma recusa da VPS fica registrada em `voip_calls`.
 *
 * ─── por que o estado é `ended`, e não `expired` ────────────────────────────
 *
 * `expired` tem UM significado neste esquema, e está escrito nas RPCs que o
 * produzem: a reserva venceu sem ser usada e o reaper a recolheu, sempre com
 * `end_reason = 'reservation_expired'` (ver `fn_voip_call_reserve`).
 *
 * Uma recusa da VPS não é isso. As duas linhas de produção de 2026-08-03
 * gravaram `ended_at` cerca de 400ms depois de `created_at` — resposta na mão,
 * não tempo esgotado — e mesmo assim ficaram marcadas como "expirou". Quem
 * abrir o histórico depois lê a palavra errada, e "expirou" manda investigar
 * timeout de rede quando o que houve foi um `404` limpo do WhatsApp.
 *
 * `ended` é o termo que o vocabulário já tem para "esta chamada acabou", e
 * `end_reason` é o campo que diz por quê. Não precisa de migration: o CHECK de
 * `voip_calls.status` já aceita `ended`, e todo lugar que testa terminal usa
 * `IN ('ended','expired')`, então nada a jusante muda. `failed` seria mais
 * expressivo, mas exigiria alterar o CHECK em produção para ganhar pouco sobre
 * `ended` + motivo.
 *
 * ─── o motivo começa pelo código ────────────────────────────────────────────
 *
 * Era `vps_refused:<prosa>` — prefixo igual para tudo, então filtrar o
 * histórico por causa era impossível sem casar substring em inglês. Agora o
 * código estável vem primeiro e a prosa continua atrás, para o diagnóstico.
 */
export function refusedCallPatch(
  code: VpsRefusalCode,
  reason: string,
  now: string,
): { status: "ended"; end_reason: string; ended_at: string; updated_at: string } {
  return {
    status: "ended",
    end_reason: `${code}:${reason}`.slice(0, 200),
    ended_at: now,
    updated_at: now,
  };
}
