/**
 * Papel de uma janela do nó `wait_business_window`.
 *
 * Este é o **único** intérprete do vocabulário gravado em
 * `WorkflowBehaviorWindow.action`. O executor não deve espalhar
 * `startsWith("hold_until:")` / `split(":")` por conta própria — toda leitura
 * de `action` passa por `resolveWindowRole`.
 *
 * Semântica travada pelo CTO (2026-08-19): **a janela desenhada é o horário em
 * que a mensagem dispara.** Dentro de uma janela de envio, o fluxo segue; fora
 * de toda janela, dorme até a próxima abrir.
 *
 * Discriminador do vocabulário legado `hold_until:` é "o alvo está preenchido?":
 *
 *   - alvo VAZIO (`"hold_until:"`) — a UI antiga oferecia "Segurar até janela X"
 *     e nunca exigia o X. Uma janela solitária com alvo vazio só tem uma leitura
 *     sã: é a janela de trabalho. Vira `send`. (7 workflows da Chique em prod.)
 *   - alvo NOMEADO (`"hold_until:Comercial"`) — bloqueio deliberado: o usuário
 *     desenhou uma janela e mandou não enviar nela, resumindo em outra. Vira
 *     `blackout`. (Bertin: janela de sáb/dom apontando para "Comercial".)
 *
 * Desconhecido nunca falha o nó: cai em `send`. Um valor que ninguém sabe ler
 * não pode ser motivo para estrangular a org — a antiga `action` inválida
 * devolvia `{success:false}` sem escrever linha terminal, e foi exatamente
 * assim que 77 execuções ficaram `processing` para sempre.
 */

export type WindowRole =
  | { kind: "send" }
  | { kind: "route"; key: string }
  | { kind: "blackout"; resumeHint?: string };

const HOLD_PREFIX = "hold_until:";
const ROUTE_PREFIX = "route:";

const SEND: WindowRole = { kind: "send" };

/**
 * Traduz o valor gravado em `action` para o papel da janela.
 *
 * Detalhe que já quebrou em prod: `action.split(":")[1]` trunca qualquer alvo
 * ou chave que contenha `:` — `"route:a:b"` virava `"a"`. Aqui usamos
 * `slice(prefixo.length)`, então o valor sobrevive inteiro.
 *
 * O teste de "vazio" roda sobre a versão trimada, mas o valor devolvido é a
 * fatia crua (após trim do `action` inteiro). Isso preserva igualdade exata
 * contra `edge.sourceHandle` para todas as chaves de rota vivas em prod — trim
 * agressivo no meio do valor mudaria o alvo do roteamento, que é justamente o
 * que não pode mudar.
 */
export function resolveWindowRole(action: string | undefined | null): WindowRole {
  if (typeof action !== "string") return SEND;

  const raw = action.trim();
  if (raw === "" || raw === "pass") return SEND;

  if (raw.startsWith(HOLD_PREFIX)) {
    const target = raw.slice(HOLD_PREFIX.length);
    if (target.trim() === "") return SEND;
    return { kind: "blackout", resumeHint: target };
  }

  if (raw.startsWith(ROUTE_PREFIX)) {
    const key = raw.slice(ROUTE_PREFIX.length);
    if (key.trim() === "") return SEND;
    return { kind: "route", key };
  }

  return SEND;
}

/** `true` quando a janela é horário de envio (o fluxo passa dentro dela). */
export function isSendWindow(action: string | undefined | null): boolean {
  return resolveWindowRole(action).kind === "send";
}
