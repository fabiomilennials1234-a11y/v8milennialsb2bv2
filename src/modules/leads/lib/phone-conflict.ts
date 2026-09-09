/**
 * Quem já está com este telefone — e como contar isso pro usuário.
 *
 * O cadastro de lead é barrado pelo índice único `idx_leads_org_phone_unique`
 * (`organization_id` + `normalized_phone`, ignorando a lixeira). Quando ele
 * dispara, o Postgres devolve `23505` com uma mensagem que só faz sentido pra
 * quem escreveu o schema — e era isso que chegava na tela. Este módulo traduz o
 * bloqueio: diz QUAL lead segura o número e o que dá pra fazer.
 *
 * A chave usada aqui é `normalizePhone()`, espelho de `normalize_brazilian_phone()`,
 * porque é ela que o índice único usa. Avisar por uma chave diferente da do banco
 * produziria os dois erros piores: alarme sobre o que o banco aceita, e silêncio
 * sobre o que ele vai recusar.
 *
 * ATENÇÃO — a busca tem dois degraus, e o segundo existe por causa da RLS:
 *   1. consulta direta em `leads`, que passa pela RLS. Achou, o usuário PODE ver
 *      aquele lead: devolvemos nome, empresa e responsável, e ele resolve sozinho.
 *   2. não achou: pode ser que não exista, ou que exista e a RLS esconda — a RLS
 *      de `leads` é escopada por responsabilidade, mas o índice único é global na
 *      org, então o vendedor apanha de um lead que não enxerga. A RPC
 *      `lead_phone_is_taken` (SECURITY DEFINER) desempata devolvendo dois
 *      booleanos e NADA mais: quem não pode ver o lead continua sem ver quem é.
 */

import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";

export interface PhoneConflict {
  /** `false` quando o lead existe mas a RLS o esconde deste usuário. */
  visible: boolean;
  /** Lead na lixeira NÃO ocupa o índice único — vira aviso, não impedimento. */
  in_trash: boolean;
  /** Preenchidos só quando `visible` — ver o comentário do módulo. */
  id: string | null;
  name: string | null;
  company: string | null;
  responsible_name: string | null;
}

/** Código do Postgres para violação de unique constraint. */
export const UNIQUE_VIOLATION = "23505";

export function isPhoneUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === UNIQUE_VIOLATION && (e.message ?? "").includes("phone");
}

/**
 * Devolve o lead que já ocupa este telefone na org, ou `null` se não houver
 * conflito conhecido.
 *
 * `null` também é o resultado quando a consulta falha (RPC ainda não aplicada,
 * rede caindo). É de propósito: quem chama trata `null` como "sem conflito
 * conhecido" e deixa o índice único do banco decidir — ele é a garantia real,
 * com ou sem esta consulta. O contrário (bloquear o cadastro porque o lookup
 * falhou) inventaria um impedimento que o banco não tem.
 */
export async function findLeadByPhone(
  organizationId: string,
  phone: string
): Promise<PhoneConflict | null> {
  const key = normalizePhone(phone);
  if (!key) return null;

  // Degrau 1 — o que este usuário pode ver (RLS aplicada).
  const { data: rows, error } = await supabase
    .from("leads")
    .select("id, name, company, deleted_at, responsible_id")
    .eq("organization_id", organizationId)
    .eq("normalized_phone", key)
    // Ativo primeiro: é ele que bloqueia. O da lixeira só avisa.
    .order("deleted_at", { ascending: true, nullsFirst: true })
    .limit(1);

  if (error) {
    console.error("[phone-conflict] consulta de leads falhou:", error);
    return null;
  }

  const lead = rows?.[0];
  if (lead) {
    let responsible_name: string | null = null;
    if (lead.responsible_id) {
      const { data: member } = await supabase
        .from("team_members")
        .select("name")
        .eq("id", lead.responsible_id)
        .maybeSingle();
      responsible_name = member?.name ?? null;
    }

    return {
      visible: true,
      in_trash: lead.deleted_at !== null,
      id: lead.id,
      name: lead.name,
      company: lead.company,
      responsible_name,
    };
  }

  // Degrau 2 — não vi nada; existe e está escondido, ou não existe mesmo?
  const { data: taken, error: rpcError } = await supabase.rpc(
    "lead_phone_is_taken" as never,
    { p_organization_id: organizationId, p_phone: phone } as never
  );

  if (rpcError) {
    // Inclui o caso "migration ainda não aplicada" (PGRST202). Sem resposta,
    // seguimos sem afirmar nada — ver o comentário do JSDoc.
    console.error("[phone-conflict] lead_phone_is_taken indisponível:", rpcError);
    return null;
  }

  const row = ((taken ?? []) as { taken: boolean; in_trash: boolean }[])[0];
  if (!row || (!row.taken && !row.in_trash)) return null;

  return {
    visible: false,
    in_trash: !row.taken && row.in_trash,
    id: null,
    name: null,
    company: null,
    responsible_name: null,
  };
}

/** Mensagem do bloqueio duro: existe lead ATIVO com este telefone. */
export function describePhoneConflict(conflict: PhoneConflict): string {
  if (!conflict.visible) {
    return (
      "Este telefone já está cadastrado em um lead desta organização que não " +
      "aparece para você — pode estar na carteira de outro vendedor. " +
      "Peça a um administrador para localizá-lo, ou corrija o número."
    );
  }

  const quem = conflict.company
    ? `${conflict.name} (${conflict.company})`
    : conflict.name;
  const dono = conflict.responsible_name
    ? ` — responsável: ${conflict.responsible_name}`
    : "";

  return (
    `Este telefone já está cadastrado no lead "${quem}"${dono}. ` +
    `Abra esse lead para continuar o atendimento, ou corrija o número.`
  );
}

/** Texto do confirm quando o telefone é de um lead da LIXEIRA (que não bloqueia). */
export function describeTrashPhoneConflict(conflict: PhoneConflict): string {
  const quem = conflict.visible && conflict.name ? `"${conflict.name}"` : "um lead";

  return (
    `Este telefone é de ${quem}, que está na LIXEIRA. Criar um lead novo mesmo assim?\n\n` +
    `Para recuperar o antigo com o histórico, cancele e use Leads › Lixeira. ` +
    `Enquanto o lead novo existir, o da lixeira não poderá ser restaurado.`
  );
}

type PhoneGate =
  | { kind: "block"; message: string }
  | { kind: "confirm"; message: string }
  | null;

/**
 * Pré-checagem de duplicidade de telefone, antes de tentar criar o lead.
 *
 * Só antecipa o que o índice único faria — nunca decide sozinha. Por isso lead
 * na lixeira vira pergunta (ele não ocupa o índice) e o resto vira bloqueio
 * (insistir só produziria o 23505).
 */
export async function checkPhoneBeforeCreate(
  organizationId: string,
  phone: string | null | undefined
): Promise<PhoneGate> {
  if (!phone) return null;

  const conflict = await findLeadByPhone(organizationId, phone);
  if (!conflict) return null;

  if (conflict.in_trash) {
    return { kind: "confirm", message: describeTrashPhoneConflict(conflict) };
  }

  return { kind: "block", message: describePhoneConflict(conflict) };
}

/**
 * Traduz o erro de salvar lead quando ele for a violação do índice de telefone.
 * Devolve `null` quando o erro é outro — aí quem chama segue com o próprio
 * tratamento.
 *
 * Existe porque o `catch` também pega o que a pré-checagem não viu: duas abas
 * cadastrando junto, lead criado por webhook no meio do caminho, e a EDIÇÃO
 * trocando o telefone para um número já ocupado (esse caminho nem passa pela
 * pré-checagem).
 */
export async function phoneConflictMessage(
  error: unknown,
  organizationId: string | null | undefined,
  phone: string | null | undefined
): Promise<string | null> {
  if (!isPhoneUniqueViolation(error)) return null;

  const conflict = organizationId && phone
    ? await findLeadByPhone(organizationId, phone)
    : null;

  return conflict
    ? describePhoneConflict(conflict)
    : "Este telefone já está cadastrado em outro lead desta organização. " +
        "Corrija o número ou abra o lead existente.";
}
