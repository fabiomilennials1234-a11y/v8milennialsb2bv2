/**
 * Resolução de CHIP → conjunto de `instance_id` que já pertenceram a ele.
 *
 * ── Por que a leitura da conversa deixou de ser de UMA instância ──
 * Excluir uma instância de WhatsApp desatava todo o histórico dela: a FK
 * `whatsapp_messages_instance_id_fkey` era `ON DELETE SET NULL`, então a
 * conversa inteira perdia o vínculo e o chat — que filtrava
 * `.eq("instance_id", <instância viva>)` — parava de enxergá-la, embora as
 * mensagens seguissem no banco e no aparelho. Medido em prod (2026-08-10):
 * 385.828 linhas órfãs, com o ciclo excluir→recriar acontecendo em minutos.
 *
 * O desenho aprovado mantém a instância sendo DELETADA de verdade (o reap no
 * provider depende disso) e tira `instance_id` do ciclo de vida dela: o uuid
 * passa a ser identificador HISTÓRICO, e o mapa chip → uuids passa a viver na
 * lápide (`whatsapp_instance_reap_queue`). Quem lê esse mapa é
 * `whatsapp_chip_instance_ids(p_org, p_instance)`, criada pela migration
 * `20270811000011_whatsapp_historico_por_chip.sql` — cujo apply é passo MANUAL,
 * então este módulo não pode supor que ela exista (seção seguinte).
 *
 * ── Por que a falha é engolida ──
 * O front sobe sozinho no merge pra `main`; migration é passo manual. Ou seja,
 * este código roda em produção ANTES da função existir, e nesse intervalo a RPC
 * responde 404/`42883`. Derrubar a thread por causa de um ganho incremental
 * seria trocar um bug de recuperação por um apagão — então a falha degrada pro
 * comportamento de hoje (só a instância viva) e o chat continua abrindo.
 * **Só o erro DESTA resolução é tolerado**: o erro da query de mensagens
 * continua subindo, como sempre.
 *
 * ── Por que cache de módulo e não react-query ──
 * A thread é refetchada com frequência (realtime + backstop periódico), mas o
 * mapa chip → uuids só muda quando alguém exclui/recria uma instância. Um cache
 * aqui dedupa também as chamadas em voo — a bolha de chat resolve N chips em
 * paralelo — e mantém `whatsappMessagesQuery.ts` livre de TanStack Query, que
 * hoje não é dependência de nenhum arquivo de `lib/`.
 */
import { supabase } from "@/integrations/supabase/client";

/** TTL do conjunto resolvido. Consulta barata, mas não a cada fetch de thread. */
export const CHIP_IDS_TTL_MS = 5 * 60_000;

/**
 * TTL do resultado degradado. Curto de propósito: quando a migration entra em
 * prod, a aba já aberta volta a enxergar o histórico em ≤1min, sem F5.
 */
export const CHIP_IDS_FALLBACK_TTL_MS = 60_000;

interface CacheEntry {
  ids: Promise<readonly string[]>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const cacheKey = (organizationId: string, instanceId: string) =>
  `${organizationId}::${instanceId}`;

/**
 * `src/integrations/supabase/types.ts` é gerado a partir do schema de PROD, e a
 * função só nasce quando a migration for aplicada lá — regenerar antes disso
 * corromperia o arquivo (regra do projeto). Até o apply, a assinatura fica
 * declarada aqui, no ponto de uso, em vez de espalhar `as any`.
 */
type ChipInstanceIdsRpc = (
  fn: "whatsapp_chip_instance_ids",
  args: { p_org: string; p_instance: string },
) => Promise<{ data: unknown; error: { message?: string } | null }>;

/** Quando o warn degradado foi impresso pela última vez (epoch ms). */
let lastDegradedWarnAt = 0;

function warnDegradedOnce(err: unknown): void {
  const now = Date.now();
  // Uma org grande resolve dezenas de chips em paralelo; sem janela, o console
  // viraria muro de texto e esconderia o próprio aviso.
  if (now - lastDegradedWarnAt < CHIP_IDS_FALLBACK_TTL_MS) return;
  lastDegradedWarnAt = now;
  console.warn(
    "[chat] resolução de chip indisponível — thread limitada à instância viva",
    err,
  );
}

/**
 * A instância viva encabeça o conjunto e nunca falta. Mesmo que a RPC devolva
 * vazio, nulo ou lixo, o pior caso tem que ser o comportamento de hoje — nunca
 * uma thread sem filtro de instância, que fundiria os chips departamentais da
 * mesma org numa conversa só.
 */
function withLiveInstanceFirst(instanceId: string, data: unknown): readonly string[] {
  const out = [instanceId];
  if (Array.isArray(data)) {
    for (const id of data) {
      if (typeof id === "string" && id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

async function fetchChipInstanceIds(
  organizationId: string,
  instanceId: string,
): Promise<readonly string[]> {
  const rpc = supabase.rpc as unknown as ChipInstanceIdsRpc;
  const { data, error } = await rpc("whatsapp_chip_instance_ids", {
    p_org: organizationId,
    p_instance: instanceId,
  });
  if (error) throw error;
  return withLiveInstanceFirst(instanceId, data);
}

/**
 * IDs de instância que a leitura de histórico desse chip deve varrer: a
 * instância viva mais as que já foram excluídas no mesmo número.
 *
 * Nunca rejeita — ver "Por que a falha é engolida" no topo do arquivo.
 */
export function resolveChipInstanceIds(
  organizationId: string | null | undefined,
  instanceId: string | null | undefined,
): Promise<readonly string[]> {
  // Sem instância não há conversa; sem org não há como consultar o mapa, e o
  // filtro por instância viva já é multi-tenant por construção.
  if (!instanceId) return Promise.resolve([]);
  if (!organizationId) return Promise.resolve([instanceId]);

  const key = cacheKey(organizationId, instanceId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.ids;

  const entry: CacheEntry = {
    expiresAt: Date.now() + CHIP_IDS_TTL_MS,
    ids: fetchChipInstanceIds(organizationId, instanceId).catch((err) => {
      entry.expiresAt = Date.now() + CHIP_IDS_FALLBACK_TTL_MS;
      warnDegradedOnce(err);
      return [instanceId] as readonly string[];
    }),
  };
  cache.set(key, entry);
  return entry.ids;
}

/**
 * Mapa `id histórico → instância VIVA`, para um conjunto de instâncias
 * permitidas. Usado por quem precisa do caminho de volta: o deep-link acha a
 * mensagem num uuid morto, mas quem abre a tela (e quem envia) só entende a
 * instância viva.
 *
 * Instância viva sempre mapeia pra si mesma — é o que garante que o resultado
 * continue dentro da allowlist de tenancy, mesmo que o mapa venha torto.
 */
export async function resolveChipInstanceIdMap(
  organizationId: string | null | undefined,
  instanceIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const live of instanceIds) map.set(live, live);

  const sets = await Promise.all(
    instanceIds.map((live) => resolveChipInstanceIds(organizationId, live)),
  );
  sets.forEach((ids, index) => {
    const live = instanceIds[index];
    // Primeiro chip vence o empate: dois números idênticos na mesma org são
    // patologia de dado, e resolver determinístico é melhor que alternar.
    for (const id of ids) if (!map.has(id)) map.set(id, live);
  });

  return map;
}

/** Só pra teste — o cache é de módulo e vaza entre casos. */
export function clearChipInstanceIdsCache(): void {
  cache.clear();
  lastDegradedWarnAt = 0;
}
