/**
 * Prévia da sincronização de clientes — o que ACONTECERIA, sem escrever nada.
 *
 * Existe porque `toth-sync-clientes` é tudo-ou-nada: até 20 páginas × 100 = 2000
 * clientes numa tacada, criando lead para cada um. Criar lead é a única escrita
 * desta integração que acorda gatilho (`leads` tem 20 triggers; `upsell_clients`
 * tem um, e só carimba `updated_at`). Antes de uma escrita dessas numa org de
 * cliente, é preciso poder olhar.
 *
 * O número que mais importa aqui não é quantos clientes vêm — é **quantas
 * conversas órfãs seriam adotadas**. O trigger `tg_leads_adopt_orphan_messages`
 * pendura toda `whatsapp_messages` sem dono cujo `normalized_phone` bata com o do
 * lead recém-criado. Isso muda a operação de quem já usa o WhatsApp, e é o tipo
 * de efeito que ninguém prevê olhando "importar clientes do ERP".
 *
 * A previsão usa `normalizePhoneForSearch`, que é espelho byte-a-byte de
 * `normalize_brazilian_phone` no banco — inclusive na peculiaridade de inserir
 * um "9" em número de 10 dígitos (o fixo `4832631404` vira `48932631404`).
 * Reproduzir a peculiaridade é o que faz a prévia valer: normalizar "melhor" que
 * o banco daria um número bonito e errado.
 */

import { CanonicalClient } from "./types.ts";
import type { ErpSyncMode } from "./sync/upsert-client.ts";

/** O que o upsert faria com este cliente, sem fazer. */
export type PreviewAction = "create" | "enrich" | "skip";

export interface PreviewedClient {
  externalId: string;
  action: PreviewAction;
  reason: string;
  /** Telefone já normalizado como o banco normalizaria. Null quando não há. */
  normalizedPhone: string | null;
}

export interface DryRunTotals {
  mapped: number;
  wouldCreate: number;
  wouldEnrich: number;
  wouldSkip: number;
  withCnpj: number;
  withPhone: number;
  withEmail: number;
}

/**
 * Decide a ação sem escrever. Espelha a lógica de `upsertCanonicalClient`:
 * casa por external_id, depois por CNPJ; `enrich_only` nunca cria.
 */
export function previewAction(
  params: {
    client: CanonicalClient;
    syncMode: ErpSyncMode;
    matchedByExternalId: boolean;
    matchedByCnpj: boolean;
  },
): { action: PreviewAction; reason: string } {
  const { syncMode, matchedByExternalId, matchedByCnpj } = params;

  if (syncMode === "off") return { action: "skip", reason: "mode_off" };
  if (matchedByExternalId) return { action: "enrich", reason: "match_external_id" };
  if (matchedByCnpj) return { action: "enrich", reason: "match_cnpj" };

  // Sem correspondência: só `canonical` cria — e criar é o que gera lead novo.
  return syncMode === "canonical"
    ? { action: "create", reason: "unmatched_canonical" }
    : { action: "skip", reason: "unmatched" };
}

/** Consolida os totais da prévia. */
export function summarize(
  clients: CanonicalClient[],
  previews: PreviewedClient[],
): DryRunTotals {
  const count = (p: PreviewAction) => previews.filter((x) => x.action === p).length;
  return {
    mapped: previews.length,
    wouldCreate: count("create"),
    wouldEnrich: count("enrich"),
    wouldSkip: count("skip"),
    withCnpj: clients.filter((c) => !!c.cnpj).length,
    withPhone: clients.filter((c) => !!c.phone).length,
    withEmail: clients.filter((c) => !!c.email).length,
  };
}

/**
 * Telefones normalizados, únicos, apenas dos clientes que SERIAM CRIADOS.
 *
 * Só a criação dispara a adoção de órfãs — enriquecer um cliente existente não
 * cria lead, e o lead que já existe já adotou o que tinha para adotar.
 */
export function phonesAtRisk(previews: PreviewedClient[]): string[] {
  const phones = previews
    .filter((p) => p.action === "create" && p.normalizedPhone)
    .map((p) => p.normalizedPhone as string);
  return [...new Set(phones)];
}

/**
 * Amostra para conferência humana.
 *
 * Devolve VALOR, ao contrário de `toth-probe`, que devolve só forma. É
 * deliberado e a diferença é o destinatário: o probe é diagnóstico de contrato e
 * pode acabar em log; isto responde "os nomes e CNPJs estão certos?" para um
 * admin olhando os dados da PRÓPRIA organização. Por isso vai na resposta HTTP
 * e **nunca** em `runtime_logs`.
 */
export function sampleForReview(
  clients: CanonicalClient[],
  previews: PreviewedClient[],
  size = 5,
): Array<Record<string, unknown>> {
  const byId = new Map(previews.map((p) => [p.externalId, p]));
  return clients.slice(0, size).map((c) => ({
    external_id: c.externalId,
    nome: c.name,
    empresa: c.company,
    cnpj: c.cnpj,
    telefone_normalizado: byId.get(c.externalId)?.normalizedPhone ?? null,
    email: c.email,
    acao: byId.get(c.externalId)?.action ?? "?",
  }));
}
