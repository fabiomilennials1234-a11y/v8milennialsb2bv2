/**
 * O contrato de erro do Torque (ADR-0038).
 *
 * Todo erro que cruza uma fronteira — banco → front, edge function → front,
 * front → tela — vira um `AppError`. A tela lê só `userMessage` e `action`; a
 * causa técnica viaja inteira em `cause` e nunca é renderizada.
 */

export type ErrorCode =
  | "permission.denied"
  | "auth.session_expired"
  | "auth.invalid_credentials"
  | "auth.email_not_confirmed"
  | "auth.weak_password"
  | "auth.user_exists"
  | "record.not_found"
  | "record.duplicate"
  | "record.in_use"
  | "validation.invalid"
  | "conflict.stale"
  | "rate.limited"
  | "network.offline"
  | "request.timeout"
  | "server.unavailable"
  | "unknown";

/** O que a tela oferece ao lado da mensagem. */
export type ErrorActionKind = "sign_in" | "support";

export interface ErrorAction {
  kind: ErrorActionKind;
  label: string;
}

export interface AppError {
  code: ErrorCode;
  /** PT-BR: o que aconteceu e o que fazer. Nunca contém texto técnico. */
  userMessage: string;
  action?: ErrorAction;
  /**
   * Código curto (8 hex, maiúsculo) que o cliente copia e o suporte procura.
   * O mesmo objeto de erro recebe sempre a mesma referência, então o toast e o
   * relatório concordam mesmo quando o erro passa por dois tratadores.
   */
  reference: string;
  retryable: boolean;
  /**
   * `true` quando o erro indica defeito e deve virar evento (Sentry). Recusa
   * esperada — validação, sessão vencida, recusa deliberada de RPC — vira só
   * rastro, para não enterrar o sinal nem queimar a cota.
   */
  reportable: boolean;
  /** A causa original, intacta. Para relatório; nunca para a tela. */
  cause: unknown;
}
