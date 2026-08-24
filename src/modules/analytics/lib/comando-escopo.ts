/**
 * A regra de visibilidade da aba Comando, isolada e PURA.
 *
 * Vive aqui, e não dentro dos cards, pelo mesmo motivo que
 * `tarefas-do-dia.ts` existe: os três blocos e o resumo do cabeçalho precisam
 * responder a MESMA pergunta, e três implementações da mesma regra divergem na
 * primeira semana. É também o único jeito de testar a regra sem montar
 * componente nem subir banco.
 *
 * ─── A regra, em uma frase ──────────────────────────────────────────────────
 *
 *   "vejo o que é MEU + o que não é de NINGUÉM; nunca o de OUTRO."
 *
 * O segundo termo não é generosidade — é o que impede a tela de mentir por
 * omissão. Medido no PROD em 2026-08-24: 61% das reuniões de confirmação, 21%
 * dos follow-ups e 40% das conversas em espera não têm responsável. Uma regra
 * de "só o que é meu" apagaria a maior parte da operação da tela de todo
 * vendedor, e ninguém perceberia. Registro órfão também não é "dado de outro
 * usuário", que é o que o pedido manda proteger.
 *
 * ─── ⚠️ Isto NÃO é a barreira de segurança ──────────────────────────────────
 *
 * Quem garante a regra é o banco: as RPCs
 * `get_conversations_awaiting_human_reply` e `get_comando_agenda_events`
 * decidem o escopo DENTRO delas (por `is_org_admin`), e `acoes_do_dia` decide
 * por RLS. Este arquivo existe para (a) a tela saber o que rotular e (b) o
 * caminho degradado da agenda, enquanto a migration não estiver aplicada.
 * Mudar qualquer coisa aqui não afrouxa nada no servidor.
 */

/** `tudo` é privilégio de admin/master; todo o resto opera em `meu`. */
export type ComandoEscopo = "meu" | "tudo";

/**
 * Fail-closed de propósito: enquanto a identidade não resolveu, `isAdmin` é
 * `false` e o escopo nasce `meu`. O admin vê a lista abrir por um instante e
 * depois completar — o inverso (nascer `tudo` e encolher) mostraria dado alheio
 * a quem não podia, mesmo que por meio segundo.
 */
export function escopoDoUsuario(isAdmin: boolean): ComandoEscopo {
  return isAdmin ? "tudo" : "meu";
}

/**
 * O predicado, aplicado a UMA linha.
 *
 * @param donoId  o responsável da linha, já normalizado para `team_members.id`
 *                (ou `null` quando ninguém responde por ela)
 * @param meuId   o `team_members.id` de quem está olhando — `null` para master
 *                e gestor, que não têm linha real em `team_members`
 */
export function linhaVisivel(
  donoId: string | null | undefined,
  meuId: string | null | undefined,
  escopo: ComandoEscopo,
): boolean {
  if (escopo === "tudo") return true;
  if (!donoId) return true; // não é de ninguém
  return !!meuId && donoId === meuId; // é meu
}

// ─── Agenda: normalizar o dono antes de comparar ─────────────────────────────

/**
 * 🔴 `created_by` da `get_agenda_events` carrega DOIS espaços de id, e nada no
 * tipo denuncia isso:
 *
 *   | source            | o id é de…       |
 *   |-------------------|------------------|
 *   | meeting           | `auth.users.id`  |
 *   | follow_up         | `team_members.id`|
 *   | scheduled_message | `team_members.id`|
 *   | pipe_confirmacao  | `team_members.id`|
 *   | meeting_event     | `team_members.id`|
 *
 * Comparar a coluna crua contra um único id devolve resultado silenciosamente
 * errado — some metade da agenda, sem erro nenhum. Esta função é o antídoto:
 * responde "esta linha é minha?" sabendo qual id comparar em cada fonte.
 *
 * A RPC `get_comando_agenda_events` já devolve `owner_team_member_id`
 * normalizado e já filtrou no servidor; isto só é exercitado no caminho
 * degradado (banco ainda sem a migration).
 */
export function eventoDaAgendaEhMeu(
  evento: { source: string; created_by: string | null },
  meuTeamMemberId: string | null | undefined,
  meuUserId: string | null | undefined,
): boolean {
  if (!evento.created_by) return false;
  return evento.source === "meeting"
    ? !!meuUserId && evento.created_by === meuUserId
    : !!meuTeamMemberId && evento.created_by === meuTeamMemberId;
}

/** Versão de `linhaVisivel` que entende os dois espaços de id da agenda. */
export function eventoDaAgendaVisivel(
  evento: { source: string; created_by: string | null },
  meuTeamMemberId: string | null | undefined,
  meuUserId: string | null | undefined,
  escopo: ComandoEscopo,
): boolean {
  if (escopo === "tudo") return true;
  if (!evento.created_by) return true; // não é de ninguém
  return eventoDaAgendaEhMeu(evento, meuTeamMemberId, meuUserId);
}
