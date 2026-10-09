/**
 * Donos do lead — N por lead (Chamado 793f4b05).
 *
 * Módulo PURO. Recebe a linha do lead como a lista/ficha a leem (joins de
 * `team_members` por coluna + o embed opcional de `lead_owners`) e devolve os
 * donos na ordem de exibição, sem repetição.
 *
 * DUAS FONTES, UMA RESPOSTA:
 *   - org COM a flag `lead_owners_n_donos`: o embed `lead_owners` chega e é a
 *     verdade — principal de venda, principal de pré-venda, co-donos;
 *   - org SEM a flag (todas as outras): o embed não é pedido e a resposta é
 *     o dono único de sempre, pela precedência que a lista pinta desde antes
 *     (`sale_responsible ?? pre_sale_responsible ?? responsible`). A tela
 *     dessas orgs não muda.
 *
 * Embed presente mas vazio (lead sem dono na org com flag) cai na mesma
 * precedência: `responsible_id` legado continua aparecendo como hoje.
 */

/** Selecione isto para trazer os donos junto com o lead (só em org com a flag). */
export const LEAD_OWNERS_EMBED =
  "lead_owners(team_member_id, role, is_primary, added_at, team_members(id, name, avatar_url))";

/**
 * Acrescenta o embed dos donos a um `select` do PostgREST quando `ligado`.
 *
 * O tipo devolvido é o do select de ENTRADA, de propósito: o parser de tipos
 * do supabase-js não lê um select montado em runtime e degradaria a linha
 * inteira para erro de parse. O campo extra (`lead_owners`) é tipado à parte,
 * opcional, em `LeadOwnersSource`/`LeadListItem` — quem lê já trata ausência.
 */
export function comEmbedDosDonos<S extends string>(select: S, ligado: boolean): S {
  return (ligado ? `${select}, ${LEAD_OWNERS_EMBED}` : select) as S;
}

/** Chave em `organizations.feature_flags` que liga N donos por lead. */
export const LEAD_OWNERS_FLAG = "lead_owners_n_donos";

export type LeadOwnerRole = "venda" | "pre_venda" | "co";

/** Uma linha do embed `lead_owners(...)`. */
export interface LeadOwnerRow {
  team_member_id: string;
  role: string;
  is_primary: boolean;
  added_at?: string | null;
  team_members?: { id: string; name: string | null; avatar_url?: string | null } | null;
}

interface MembroJoin {
  id?: string | null;
  name?: string | null;
  avatar_url?: string | null;
}

/** O que `resolveLeadOwners` lê do lead. Tudo opcional: shapes de origens diferentes. */
export interface LeadOwnersSource {
  lead_owners?: LeadOwnerRow[] | null;
  sale_responsible?: MembroJoin | null;
  pre_sale_responsible?: MembroJoin | null;
  responsible?: MembroJoin | null;
}

export interface LeadOwner {
  /** `team_members.id`. */
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Papéis desta pessoa no lead, na ordem venda → pré-venda → co. Vazio = `responsible_id` legado. */
  papeis: LeadOwnerRole[];
}

const ORDEM_DO_PAPEL: Record<LeadOwnerRole, number> = { venda: 0, pre_venda: 1, co: 2 };

function papelValido(role: string): role is LeadOwnerRole {
  return role === "venda" || role === "pre_venda" || role === "co";
}

function nomeValido(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function precedenciaLegada(src: LeadOwnersSource): LeadOwner[] {
  const candidatos: Array<[MembroJoin | null | undefined, LeadOwnerRole[]]> = [
    [src.sale_responsible, ["venda"]],
    [src.pre_sale_responsible, ["pre_venda"]],
    [src.responsible, []],
  ];
  for (const [m, papeis] of candidatos) {
    if (m && nomeValido(m.name)) {
      return [{ id: m.id ?? "", name: m.name, avatarUrl: m.avatar_url ?? null, papeis }];
    }
  }
  return [];
}

/**
 * Donos do lead na ordem de exibição: principal de venda, principal de
 * pré-venda, co-donos (mais antigos primeiro). A mesma pessoa em dois papéis
 * aparece UMA vez, com os dois papéis.
 */
export function resolveLeadOwners(src: LeadOwnersSource | null | undefined): LeadOwner[] {
  if (!src) return [];
  const linhas = (src.lead_owners ?? []).filter(
    (r): r is LeadOwnerRow & { role: LeadOwnerRole } =>
      !!r && typeof r.team_member_id === "string" && papelValido(r.role) && nomeValido(r.team_members?.name),
  );
  if (linhas.length === 0) return precedenciaLegada(src);

  const ordenadas = [...linhas].sort((a, b) => {
    const p = ORDEM_DO_PAPEL[a.role] - ORDEM_DO_PAPEL[b.role];
    if (p !== 0) return p;
    const t = (a.added_at ?? "").localeCompare(b.added_at ?? "");
    if (t !== 0) return t;
    return (a.team_members?.name ?? "").localeCompare(b.team_members?.name ?? "", "pt-BR");
  });

  const porMembro = new Map<string, LeadOwner>();
  for (const r of ordenadas) {
    const atual = porMembro.get(r.team_member_id);
    if (atual) {
      if (!atual.papeis.includes(r.role)) atual.papeis.push(r.role);
      continue;
    }
    porMembro.set(r.team_member_id, {
      id: r.team_member_id,
      name: r.team_members!.name as string,
      avatarUrl: r.team_members?.avatar_url ?? null,
      papeis: [r.role],
    });
  }
  return [...porMembro.values()];
}

/** Rótulo do papel principal do dono, para title/aria. */
export function rotuloDoPapel(owner: LeadOwner): string {
  const papel = owner.papeis[0];
  if (papel === "venda") return "Responsável de venda";
  if (papel === "pre_venda") return "Responsável de pré-venda";
  if (papel === "co") return "Co-responsável";
  return "Responsável";
}

/** "Ana, Bia e Carla" — para title e aria-label. */
export function nomesDosDonos(owners: LeadOwner[]): string {
  const nomes = owners.map((o) => o.name);
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}
