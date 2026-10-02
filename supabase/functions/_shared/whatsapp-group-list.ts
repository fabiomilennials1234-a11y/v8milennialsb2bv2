/**
 * whatsapp-group-list — os grupos de uma instância, prontos para o seletor do
 * nó `send_to_group` (action `listGroups` do `whatsapp-api-proxy`).
 *
 * Puro sobre o provider: recebe qualquer coisa com `listChats` e devolve a
 * lista filtrada, sem I/O próprio. A autorização (tenant, permissão de editar
 * automações, provedor) é do proxy, antes de chamar isto.
 *
 * Regras:
 *  - só JIDs que passam por `isValidGroupJid` — o mesmo portão do executor; um
 *    grupo que a lista oferecesse e o envio recusasse seria armadilha na tela;
 *  - dedup por JID, mantendo o primeiro nome não-vazio;
 *  - ordem alfabética pt-BR sem acento e sem caixa (o operador procura por nome);
 *  - teto de `GROUP_LIST_CAP`, com `truncated` para a tela avisar;
 *  - nome vazio vira "Grupo sem nome (…final do JID)" — a opção nunca é branca.
 */

import { isValidGroupJid } from "./whatsapp-jid.ts";
import { GROUP_PROVIDERS } from "./instance-routing.ts";

export const GROUP_LIST_CAP = 1000;

export interface GroupListItem {
  jid: string;
  name: string;
}

export interface GroupListResult {
  groups: GroupListItem[];
  truncated: boolean;
}

type ChatLike = { id?: string | null; name?: string | null };

export interface GroupListingProvider {
  listChats?(type?: "all" | "individual" | "group"): Promise<ChatLike[]>;
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

function fallbackName(jid: string): string {
  const local = jid.split("@")[0];
  return `Grupo sem nome (…${local.slice(-6)})`;
}

export async function listInstanceGroups(
  provider: GroupListingProvider,
): Promise<GroupListResult> {
  if (typeof provider.listChats !== "function") {
    throw new Error("provider does not support listChats");
  }
  const chats = await provider.listChats("group");

  const byJid = new Map<string, string>();
  for (const chat of chats ?? []) {
    const jid = chat?.id;
    if (!isValidGroupJid(jid)) continue;
    const name = typeof chat.name === "string" ? chat.name.trim() : "";
    const current = byJid.get(jid);
    if (current === undefined || (!current && name)) byJid.set(jid, name);
  }

  const all: GroupListItem[] = [...byJid.entries()].map(([jid, name]) => ({
    jid,
    name: name || fallbackName(jid),
  }));
  all.sort((a, b) => collator.compare(a.name, b.name) || a.jid.localeCompare(b.jid));

  return {
    groups: all.slice(0, GROUP_LIST_CAP),
    truncated: all.length > GROUP_LIST_CAP,
  };
}

// ============================================================================
// Autorização da action `listGroups` (whatsapp-api-proxy)
// ============================================================================

export type GroupListGate =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * O gate EXTRA da `listGroups`, aplicado DEPOIS da fronteira de tenant do proxy
 * (instância de outra org já saiu em 403 + `cross_tenant_attempt`).
 *
 * Listar os grupos de um número expõe nomes de grupos — informação que o membro
 * comum não vê em lugar nenhum da tela. Só quem edita automações (o único
 * consumidor desta lista) passa; Master e Gestor de Portfólio passam por fora,
 * como em todo o proxy. A permissão é perguntada ao banco com o JWT do usuário
 * (`has_feature_permission` lê `auth.uid()`), nunca decidida aqui.
 *
 * Provedor sem grupo responde 422 com código estável, para a tela cair no
 * campo manual em vez de mostrar erro genérico.
 */
export async function authorizeGroupListing(args: {
  isMaster: boolean;
  isGestor: boolean;
  provider: string | null | undefined;
  canEditWorkflows: () => Promise<{ data: unknown; error: unknown }>;
}): Promise<GroupListGate> {
  if (!args.isMaster && !args.isGestor) {
    const { data, error } = await args.canEditWorkflows();
    if (error) {
      return {
        ok: false,
        status: 503,
        body: { error: "Não foi possível verificar sua permissão. Tente novamente." },
      };
    }
    if (data !== true) {
      return { ok: false, status: 403, body: { error: "Sem permissão para editar automações" } };
    }
  }
  if (!(GROUP_PROVIDERS as readonly string[]).includes(String(args.provider))) {
    return {
      ok: false,
      status: 422,
      body: { error: "Este número não lista grupos", code: "groups_not_supported" },
    };
  }
  return { ok: true };
}
