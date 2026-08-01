/**
 * Os números de voz por onde ESTE vendedor pode ligar.
 *
 * Antes daqui existia `useVoipSession` (singular), que fazia
 * `.eq("status","open").limit(1)` na organização inteira. Dois defeitos num
 * `.limit(1)`:
 *
 *  1. Com dois números de voz na org, qual atendia era sorte — sem ordenação, o
 *     Postgres devolve o que quiser.
 *  2. Não perguntava se aquele vendedor podia usar aquele número. O inbox de
 *     mensagens pergunta desde sempre; a voz ignorava a tabela inteira.
 *
 * ─── A regra de acesso NÃO nasce aqui ───────────────────────────────────────
 * Ela vive em `useWhatsAppInstancesForUser`, que é o que o inbox usa:
 *   · instância SEM ninguém em `whatsapp_instance_allowed_members` → toda a org
 *   · instância COM lista                                          → só a lista
 *   · admin e master (usuário virtual)                             → bypass
 *
 * Este hook CONSOME aquele hook. Reescrever o predicado aqui seria criar uma
 * segunda definição da mesma regra, e é exatamente aí que a divergência nasce:
 * o servidor (`public.fn_voip_can_use_instance`, chamada por
 * `fn_voip_call_reserve` e por `_shared/voip/call-plane.ts`) usaria um critério
 * e a tela outro — ou some o botão de quem pode, ou se oferece botão para quem
 * o servidor vai recusar com `not_instance_member` (HTTP 403).
 *
 * ─── As quatro condições, e de onde cada uma vem ────────────────────────────
 * (Existe uma QUINTA, que não é sobre número e sim sobre lead — a dona do lead,
 * em `useCanCallLead`, no fim deste arquivo. Todas as cinco traduzem o mesmo
 * gate do servidor, e ficam juntas pelo mesmo motivo.)
 *
 * Um número só serve para ligar quando as quatro valem ao mesmo tempo:
 *   · o vendedor tem a permissão de ligar     → `useCanDo("voip.call.start")`
 *   · o vendedor pode usar a instância        → `useWhatsAppInstancesForUser`
 *   · a instância tem voz ligada              → `whatsapp_instances.voice_calls_enabled`
 *   · existe sessão `open` naquela instância  → `voip_sessions`
 * As quatro são as mesmas que o servidor cobra — `permission_denied`,
 * `not_instance_member`, `voice_calls_disabled` e `session_not_open`. O elo
 * entre sessão e número é `voip_sessions.whatsapp_instance_id`.
 *
 * A permissão entra AQUI e não no botão porque é a mesma pergunta das outras
 * três: "por quais números este vendedor pode ligar?". Sem ela, o front ficava
 * mais permissivo que o servidor — a feature nasce com `default_value = true`,
 * então o furo é invisível até o primeiro admin desligar o toggle, que é
 * exatamente para isso que o toggle existe: o vendedor continuaria vendo o
 * botão, clicaria, e tomaria `permission_denied` na cara do lead.
 *
 * Lista vazia é o normal, não é erro: a feature nasce desligada e a maioria das
 * organizações nunca vai parear um número de voz. A UI usa isso para NÃO
 * mostrar o botão de ligar, em vez de mostrar um botão que sempre falha.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isVirtualTeamMember, useCanDo, useOrganization } from "@/modules/identity";
import { useWhatsAppInstancesForUser } from "@/modules/communication/hooks/chat/useWhatsAppInstances";

export interface CallableVoiceNumber {
  /** Identidade da sessão na VPS. É o que `startCall` exige. */
  tcSessionId: string;
  instanceId: string;
  /**
   * O nome que o vendedor reconhece ("Gipp teste", "sdr", "Marcão").
   * Nunca o `tc_session_id`, que não significa nada para ele.
   */
  instanceName: string;
}

/** Instância → sessão aberta, já filtrado por `voice_calls_enabled`. */
type VoiceReach = Record<string, string>;

const SEM_VOZ: VoiceReach = {};

export function useCallableVoiceNumbers(): {
  numbers: CallableVoiceNumber[];
  isLoading: boolean;
} {
  const { organizationId } = useOrganization();
  // Mesma chave de feature que `_shared/voip/call-plane.ts` cobra no outbound.
  // `useCanDo` já dá o bypass de admin e master, como `canUserAccessFeature`.
  const { allowed: podeLigar, isLoading: loadingPermissao } = useCanDo("voip.call.start");

  const { data: reach, isLoading: loadingVoice } = useQuery<VoiceReach>({
    queryKey: ["voip_voice_reach", organizationId],
    enabled: !!organizationId && podeLigar,
    // O estado muda por pareamento e por queda de conexão, não por interação da
    // tela. Recarregar a cada foco só geraria consulta.
    staleTime: 60_000,
    queryFn: async () => {
      // Duas leituras simples em vez de um join embutido: `voice_calls_enabled`
      // ainda não existe em `src/integrations/supabase/types.ts` (regenerado do
      // prod), então estas consultas já saem sem tipo — e consulta sem tipo é
      // consulta onde o erro só aparece em runtime. Nesse regime, duas
      // condições óbvias valem mais que uma cláusula esperta.
      //
      // Em SÉRIE, e não em paralelo, porque a primeira quase sempre volta
      // vazia: em ~29 das ~30 organizações não existe uma única sessão de voz
      // aberta. Sem sessão não há número, e a segunda leitura não teria o que
      // responder. Este provider vive na raiz do app, então o que se economiza
      // aqui se economiza em toda página, para todo usuário.
      const sessionsRes = await (supabase.from as unknown as (t: string) => any)("voip_sessions")
        .select("tc_session_id, whatsapp_instance_id")
        .eq("organization_id", organizationId!)
        .eq("status", "open");

      // RLS devolve vazio para quem não pode ver; erro aqui é infraestrutura.
      // Tratar como "sem voz" mantém a tela funcionando sem o botão, que é
      // melhor que um botão que falha na cara do lead.
      if (sessionsRes.error) return SEM_VOZ;

      const sessoes = (sessionsRes.data ?? []) as Array<{
        tc_session_id: string;
        whatsapp_instance_id: string;
      }>;
      if (sessoes.length === 0) return SEM_VOZ;

      const voiceRes = await (supabase.from as unknown as (t: string) => any)("whatsapp_instances")
        .select("id")
        .in("id", sessoes.map((s) => s.whatsapp_instance_id))
        .eq("voice_calls_enabled", true);

      if (voiceRes.error) return SEM_VOZ;

      const comVoz = new Set<string>(
        ((voiceRes.data ?? []) as Array<{ id: string }>).map((r) => r.id),
      );

      const porInstancia: VoiceReach = {};
      for (const row of sessoes) {
        if (!comVoz.has(row.whatsapp_instance_id)) continue;
        // `voip_sessions.jid` é UNIQUE ("um número, uma sessão"), então duas
        // sessões abertas na mesma instância não deveriam existir. Se
        // existirem, a primeira ganha — e a ordem vem do banco, não do acaso do
        // laço, porque o que a tela mostra é a lista de instâncias ordenada.
        if (porInstancia[row.whatsapp_instance_id]) continue;
        porInstancia[row.whatsapp_instance_id] = row.tc_session_id;
      }
      return porInstancia;
    },
  });

  // A REGRA DE ACESSO, inteira, vinda de quem já a implementa — mas só depois
  // de existir alguma sessão de voz aberta na organização. Este provider vive
  // fora das rotas: sem esta condição, toda página de todo usuário pagaria de 1
  // a 3 requisições para montar uma lista que quase sempre seria descartada.
  // Onde a lista importa de verdade (o chat), ela já está no cache pelo mesmo
  // `queryKey`, então a espera em série não custa render nenhum ao vendedor.
  const temVoz = !!reach && Object.keys(reach).length > 0;
  const { data: allowedInstances, isLoading: loadingInstances } = useWhatsAppInstancesForUser({
    enabled: temVoz,
  });

  const numbers = useMemo<CallableVoiceNumber[]>(() => {
    if (!reach || !allowedInstances?.length) return [];
    // A ORDEM vem daqui, e é o conserto do `.limit(1)` sem `order by`:
    // `useWhatsAppInstancesForUser` já devolve ordenado por `instance_name`,
    // então a lista é a mesma a cada render, a cada aba e a cada vendedor.
    const out: CallableVoiceNumber[] = [];
    for (const inst of allowedInstances) {
      const tcSessionId = reach[inst.id];
      if (!tcSessionId) continue;
      out.push({ tcSessionId, instanceId: inst.id, instanceName: inst.instance_name });
    }
    return out;
  }, [allowedInstances, reach]);

  // `loadingInstances` entra sem condição de propósito. Uma consulta desligada
  // fica `pending`, mas `isLoading` no react-query v5 é `isPending && isFetching`
  // (`query-core/queryObserver.js:304`) — logo ela é `false` enquanto não for
  // pedida, e `true` no instante em que `temVoz` a liga. Somar `temVoz` aqui
  // seria repetir uma condição que a biblioteca já aplica, e condição repetida
  // é condição livre para discordar da original.
  return { numbers, isLoading: loadingPermissao || loadingVoice || loadingInstances };
}

/**
 * Este vendedor alcança ESTE lead?
 *
 * A quinta condição, e a única que depende do lead — por isso ela não cabe em
 * `useCallableVoiceNumbers`, que responde "por quais números" e vive no provider
 * da raiz, onde lead nenhum existe. Mora aqui, ao lado das outras, porque as
 * cinco são a mesma tradução do mesmo gate: `_shared/voip/call-plane.ts`.
 *
 * A regra é a do servidor, à letra (`call-plane.ts`, bloco 2): SDR, closer ou
 * responsável do lead — as três colunas, e só elas. `pre_sale_responsible_id` e
 * `sale_responsible_id` existem na tabela e descrevem outra divisão de trabalho;
 * o servidor não as lê, então lê-las aqui ofereceria o botão para quem tomaria
 * `not_lead_owner` (HTTP 403) — o defeito que este hook existe para fechar.
 *
 * ─── Por que isto importa mais do que parece ────────────────────────────────
 * `leads.view_all` nasce `true` e a policy `leads_select_by_responsibility_and_permissions`
 * libera todo lead da organização. Por PADRÃO o vendedor enxerga leads alheios —
 * e ver nunca foi poder ligar. Sem esta pergunta o botão aparecia em todos eles
 * e falhava em silêncio, que é o modo mais caro de errar: ensina o vendedor a
 * desconfiar da tela inteira.
 *
 * ─── Quem bypassa ──────────────────────────────────────────────────────────
 * `isOrgAdmin` (`_shared/voip/caller.ts`) é `isMaster || isGestor || role ===
 * "admin"` — NÃO é só admin. No front os dois shadow users chegam como
 * team_member VIRTUAL (`master-virtual-*`, `gestor-virtual-*`) com `role`
 * `admin`, e `isVirtualTeamMember` é como o resto do produto já os reconhece
 * (`useWhatsAppInstancesForUser` faz o mesmo bypass, com o mesmo par). Reusar o
 * par é o que impede uma terceira definição de "admin operacional" nascer aqui.
 *
 * O id virtual não bate com coluna nenhuma de lead: sem o bypass, master e
 * gestor perderiam o botão em TODO lead.
 *
 * Sobra UM canto onde o front fica mais RESTRITO que o servidor, declarado e
 * aceito: o master que também é `team_member` real e não-admin da organização
 * chega aqui como membro comum (o virtual só é cunhado quando não há linha
 * real), e perde o botão em lead alheio que o servidor aceitaria. Errar para o
 * lado restrito esconde um botão que funcionaria; errar para o outro é
 * exatamente o defeito que esta função fecha.
 *
 * ─── O custo ───────────────────────────────────────────────────────────────
 * `leadId` nulo é como o chamador diz "ainda não vale perguntar" — o botão passa
 * nulo enquanto não houver número ao alcance, e assim as ~29 organizações sem
 * voz seguem pagando ZERO por esta condição. Admin/master/gestor também não
 * pagam: a resposta deles não depende da linha do lead. Sobra uma consulta por
 * lead, só para membro comum, só no chat, com cache por `queryKey`.
 *
 * Responde `false` até saber. É a direção segura: botão que aparece tarde custa
 * um instante; botão que aparece e falha custa a confiança na tela.
 */
export function useCanCallLead(leadId: string | null | undefined): boolean {
  const { organizationId, teamMemberId, role } = useOrganization();
  const admOperacional = isVirtualTeamMember(teamMemberId) || role === "admin";

  const { data: ehDele } = useQuery<boolean>({
    queryKey: ["voip_lead_owner", organizationId, leadId, teamMemberId],
    enabled: !!leadId && !!organizationId && !!teamMemberId && !admOperacional,
    // Muda quando alguém reatribui o lead, não por interação da tela.
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("sdr_id, closer_id, responsible_id")
        .eq("id", leadId!)
        // Em produção quem barra outra organização é a RLS de `leads`. O filtro
        // explícito é o mesmo `lead_org_mismatch` que o servidor cobra, e não
        // depende da RLS estar escrita como se espera.
        .eq("organization_id", organizationId!)
        .maybeSingle();

      // Lead ausente é `lead_not_found` no servidor; erro aqui é infraestrutura.
      // Os dois negam: um gate que abre quando o banco tosse não é gate.
      if (error || !data) return false;

      return data.sdr_id === teamMemberId ||
        data.closer_id === teamMemberId ||
        data.responsible_id === teamMemberId;
    },
  });

  if (!leadId) return false;
  if (admOperacional) return true;
  return ehDele === true;
}
