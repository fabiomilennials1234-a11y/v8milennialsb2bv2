export interface SavedView {
  id: string;
  organization_id: string;
  owner_id: string;
  name: string;
  entity_type: string;
  filters: Record<string, unknown>;
  is_shared: boolean;
  is_system: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SavedViewInsert {
  name: string;
  entity_type: SavedViewEntityType;
  filters: Record<string, unknown>;
  is_shared?: boolean;
  position?: number;
}

export interface SavedViewUpdate {
  name?: string;
  filters?: Record<string, unknown>;
  is_shared?: boolean;
  position?: number;
}

export const ME_PLACEHOLDER = "__me__";

export function resolveFilters<T extends Record<string, unknown>>(
  filters: T,
  currentUserId: string | null
): T {
  const resolved = { ...filters };
  for (const [key, value] of Object.entries(resolved)) {
    if (value === ME_PLACEHOLDER && currentUserId) {
      (resolved as Record<string, unknown>)[key] = currentUserId;
    }
  }
  return resolved;
}

// ── Entity type por funil ────────────────────────────────────────────────────
//
// Até a wave 2 do Funil é Funil, views de funil gravavam o slug da view legada
// ("pipe_whatsapp"/"pipe_confirmacao"/"pipe_propostas") em `entity_type`. Isso
// não escala pra funil custom — o funil agora é linha de `pipelines`, então o
// entity_type canônico de view de funil é `pipeline:{uuid}` (SCRUM-634).
//
// A migration 20270909001000 converte os 3 slugs legados resolvendo o funil de
// sistema da org (pipelines.type='system', slug sem o prefixo "pipe_").
// Pós-migração o dado só carrega o formato novo; os slugs legados permanecem
// no union APENAS como fallback de leitura: uma view de org sem o funil
// semeado (não migrável) mantém o slug antigo e simplesmente não aparece em
// nenhuma listagem — as queries filtram por `pipeline:{uuid}`. Nada quebra;
// `parsePipelineEntityType` devolve `null` pra elas.
//
// "leads" continua como está (view da página de Leads, não é funil).

export const PIPELINE_ENTITY_PREFIX = "pipeline:";

export type PipelineEntityType = `pipeline:${string}`;

/** Slugs legados de view de funil — só existem como fallback de leitura. */
export const LEGACY_PIPE_ENTITY_TYPES = [
  "pipe_whatsapp",
  "pipe_confirmacao",
  "pipe_propostas",
] as const;

export type LegacyPipeEntityType = (typeof LEGACY_PIPE_ENTITY_TYPES)[number];

/**
 * Todo entity_type que o app escreve ou consulta. `string` não entra de
 * propósito: quem tem um pipelineId constrói com `pipelineEntityType()`.
 */
export type SavedViewEntityType =
  | "leads"
  | PipelineEntityType
  | LegacyPipeEntityType;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Constrói o entity_type canônico de um funil. Lança se `pipelineId` não for
 * UUID — o id vem sempre de linha de `pipelines`, então formato inválido é
 * bug do chamador e precisa estourar antes de virar linha no banco.
 */
export function pipelineEntityType(pipelineId: string): PipelineEntityType {
  if (!UUID_RE.test(pipelineId)) {
    throw new Error(
      `pipelineEntityType: pipelineId inválido ("${pipelineId}") — esperado UUID`
    );
  }
  return `${PIPELINE_ENTITY_PREFIX}${pipelineId.toLowerCase()}`;
}

/** True se o entity_type é o formato canônico `pipeline:{uuid}`. */
export function isPipelineEntityType(
  entityType: string
): entityType is PipelineEntityType {
  return (
    entityType.startsWith(PIPELINE_ENTITY_PREFIX) &&
    UUID_RE.test(entityType.slice(PIPELINE_ENTITY_PREFIX.length))
  );
}

/**
 * Extrai o pipelineId de um entity_type canônico. Devolve `null` pra qualquer
 * outra coisa — inclusive slug legado ("pipe_whatsapp"): view órfã que a
 * migration não pôde resolver fica invisível, nunca vira erro.
 */
export function parsePipelineEntityType(entityType: string): string | null {
  return isPipelineEntityType(entityType)
    ? entityType.slice(PIPELINE_ENTITY_PREFIX.length).toLowerCase()
    : null;
}

/** True se o entity_type é um dos 3 slugs legados de funil. */
export function isLegacyPipeEntityType(
  entityType: string
): entityType is LegacyPipeEntityType {
  return (LEGACY_PIPE_ENTITY_TYPES as readonly string[]).includes(entityType);
}
