import type { ErrorAction, ErrorCode } from "./app-error";

interface CatalogEntry {
  /** `null` = a mensagem é o fallback do chamador, que conhece o contexto. */
  message: string | null;
  action?: ErrorAction;
  retryable: boolean;
}

const SUPPORT: ErrorAction = { kind: "support", label: "Falar com suporte" };
const SIGN_IN: ErrorAction = { kind: "sign_in", label: "Entrar novamente" };

/**
 * Códigos genéricos. O catálogo por domínio (`lead.phone_taken`,
 * `whatsapp.instance_disconnected`, …) cresce no Passo 3, na ordem da
 * frequência medida — ver `.specs/features/erros-e-observabilidade/SPEC.md`.
 */
export const ERROR_CATALOG: Record<ErrorCode, CatalogEntry> = {
  "permission.denied": {
    message:
      "Você não tem permissão para fazer isso. Peça acesso ao administrador da sua organização.",
    retryable: false,
  },
  "auth.session_expired": {
    message: "Sua sessão expirou. Entre novamente para continuar.",
    action: SIGN_IN,
    retryable: false,
  },
  "auth.invalid_credentials": {
    message: "E-mail ou senha incorretos.",
    retryable: false,
  },
  "auth.email_not_confirmed": {
    message: "Confirme seu e-mail pelo link que enviamos antes de entrar.",
    retryable: false,
  },
  "auth.weak_password": {
    message: "Essa senha é fraca demais. Use pelo menos 8 caracteres, misturando letras e números.",
    retryable: false,
  },
  // Ambígua de propósito (anti-enumeração): dizer "já existe uma conta com esse
  // e-mail" numa tela pública revela quem é cliente. Mesma regra do cadastro.
  "auth.user_exists": {
    message: "Não foi possível criar a conta com esse e-mail. Se você já tem conta, entre ou redefina a senha.",
    retryable: false,
  },
  "record.not_found": {
    message: "Este registro não existe mais ou foi removido por outra pessoa.",
    retryable: false,
  },
  "record.duplicate": {
    message: "Já existe um registro com esses dados.",
    retryable: false,
  },
  "record.in_use": {
    message: "Não dá para concluir: este registro ainda está ligado a outros dados.",
    retryable: false,
  },
  "validation.invalid": {
    message: "Algum dado enviado não é válido. Revise e tente de novo.",
    retryable: false,
  },
  "conflict.stale": {
    message: "Alguém alterou isso enquanto você editava. Recarregue a página e tente de novo.",
    retryable: true,
  },
  "rate.limited": {
    message: "Muitas tentativas seguidas. Aguarde alguns segundos e tente de novo.",
    retryable: true,
  },
  "network.offline": {
    message: "Sem conexão com o Torque. Verifique sua internet e tente de novo.",
    retryable: true,
  },
  "request.timeout": {
    message: "O Torque demorou a responder. Tente de novo em instantes.",
    retryable: true,
  },
  "server.unavailable": {
    message: "Tivemos um problema do nosso lado. Tente de novo em instantes.",
    action: SUPPORT,
    retryable: true,
  },
  unknown: {
    message: null,
    action: SUPPORT,
    retryable: false,
  },
};
