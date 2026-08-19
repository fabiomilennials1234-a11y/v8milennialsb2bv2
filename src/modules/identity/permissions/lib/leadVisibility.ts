/**
 * Visibilidade de leads: três chaves no banco, um controle na tela.
 *
 * O catálogo tem `leads.view_all`, `leads.view_unassigned` e
 * `leads.view_subordinates`. Parecem três eixos independentes. Não são — o RLS
 * colapsa eles em três NÍVEIS, e a tela mostrava quatro switches para um
 * domínio de três estados. Foi assim que a Bolívar desligou `leads.view_all`
 * inteira e não viu diferença nenhuma: sobrou `view_subordinates` ligado.
 *
 * A prova está em `is_responsible_in_same_org(sdr, closer)`, chamada por
 * `can_see_lead_by_permissions()`:
 *
 *   SELECT EXISTS (
 *     SELECT 1 FROM team_members tm_user
 *     JOIN team_members tm_resp ON tm_resp.organization_id = tm_user.organization_id
 *     WHERE tm_user.user_id = auth.uid()
 *       AND (tm_resp.id = p_sdr_id OR tm_resp.id = p_closer_id)
 *   )
 *
 * Não há checagem de subordinação em lugar nenhum: o predicado só pergunta se
 * o dono do lead pertence à mesma organização. Ou seja `view_subordinates`
 * ligado libera todo lead que tenha QUALQUER dono da org — o que, somado a
 * `view_unassigned` (que libera os órfãos), é exatamente o conjunto que
 * `view_all` libera. `leads.view_all` é redundante puro.
 *
 * Os três níveis que sobram, e que o RLS de fato distingue:
 *
 *   own                 → só os leads onde a pessoa é responsável
 *   own_and_unassigned  → + os leads sem responsável (para o vendedor pegar)
 *   all                 → todos os leads da organização
 *
 * Este módulo NÃO muda o banco. As três chaves continuam existindo, o RLS
 * continua idêntico e um `member_feature_permissions` escrito à mão continua
 * valendo. O que muda é que a tela passa a escrever as três de forma coerente,
 * em vez de deixar o admin montar combinações que o RLS ignora.
 */

/** As chaves que o controle único passa a governar. Ordem = a do catálogo. */
export const LEAD_VISIBILITY_KEYS = [
  "leads.view_all",
  "leads.view_unassigned",
  "leads.view_subordinates",
] as const;

export type LeadVisibilityKey = (typeof LEAD_VISIBILITY_KEYS)[number];

export type LeadVisibilityLevel = "own" | "own_and_unassigned" | "all";

export interface LeadVisibilityOption {
  level: LeadVisibilityLevel;
  label: string;
  description: string;
}

/**
 * Ordem crescente de alcance. A UI renderiza nesta ordem — o controle é uma
 * escala, e escala fora de ordem faz o admin escolher errado.
 */
export const LEAD_VISIBILITY_OPTIONS: readonly LeadVisibilityOption[] = [
  {
    level: "own",
    label: "Só os meus",
    description:
      "A pessoa vê apenas os leads em que é responsável. Leads sem responsável ficam invisíveis — só quem é admin distribui.",
  },
  {
    level: "own_and_unassigned",
    label: "+ sem responsável",
    description:
      "Além dos próprios, a pessoa vê os leads que ainda não têm dono e pode assumi-los. Não vê os leads de outra pessoa.",
  },
  {
    level: "all",
    label: "Todos da org",
    description:
      "A pessoa vê todos os leads da organização, inclusive os de outras pessoas.",
  },
] as const;

/**
 * Nível → as três chaves.
 *
 * `all` liga `view_subordinates` junto com `view_all` de propósito, mesmo sendo
 * redundante: é a única forma de a linha gravada continuar significando "vê
 * tudo" caso alguém um dia corrija `is_responsible_in_same_org` para de fato
 * olhar subordinação. Gravar só `view_all` deixaria a intenção dependendo de um
 * predicado que hoje mente.
 */
export function permissionsFromLevel(
  level: LeadVisibilityLevel,
): Record<LeadVisibilityKey, boolean> {
  switch (level) {
    case "all":
      return {
        "leads.view_all": true,
        "leads.view_unassigned": true,
        "leads.view_subordinates": true,
      };
    case "own_and_unassigned":
      return {
        "leads.view_all": false,
        "leads.view_unassigned": true,
        "leads.view_subordinates": false,
      };
    case "own":
      return {
        "leads.view_all": false,
        "leads.view_unassigned": false,
        "leads.view_subordinates": false,
      };
  }
}

/**
 * As três chaves → nível.
 *
 * Precisa aguentar combinação que o controle novo nunca produziria: as ~104
 * orgs existentes têm estado escrito pela tela antiga, por SQL na mão e pelo
 * default global do catálogo. A leitura segue o RLS, não a intenção de quem
 * gravou — se `view_subordinates` está ligado, a pessoa VÊ tudo, e a tela tem
 * que dizer isso mesmo que o admin acredite ter restringido.
 */
export function levelFromPermissions(
  map: Record<string, boolean | undefined>,
): LeadVisibilityLevel {
  if (map["leads.view_all"] === true || map["leads.view_subordinates"] === true) {
    return "all";
  }
  if (map["leads.view_unassigned"] === true) {
    return "own_and_unassigned";
  }
  return "own";
}

/**
 * `true` quando o estado gravado não corresponde exatamente ao que o nível
 * exibido escreveria. Serve para a tela avisar que salvar vai normalizar as
 * três chaves — mudança silenciosa de permissão é a que ninguém audita.
 */
export function isLegacyCombination(
  map: Record<string, boolean | undefined>,
): boolean {
  const canonical = permissionsFromLevel(levelFromPermissions(map));
  return LEAD_VISIBILITY_KEYS.some((key) => map[key] !== canonical[key]);
}
