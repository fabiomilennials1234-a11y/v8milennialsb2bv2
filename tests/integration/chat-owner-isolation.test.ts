// @vitest-environment node
/**
 * Política de isolamento por responsável — o membro vê o chat de um lead
 * se, e somente se, vê o lead. (#1633, PRD #1629)
 *
 * A regra é aplicada por RLS sobre `whatsapp_messages`, consumindo um
 * predicado SECURITY DEFINER. Os testes rodam como role `authenticated` com
 * JWT real — `postgres` superuser bypassa RLS e daria verde falso.
 *
 * Fixture (supabase/seed.sql), Org A:
 *   Alpha (11999990001) — pre_sale = Member1
 *   Beta  (11999990002) — sale     = Member2
 *   Gamma (11999990003) — sem responsável
 *   Delta (11999990004) — pre_sale = Member1, sale = Member2
 *   Member1 (TM 140) tem override explícito leads.view_all=false e
 *                    leads.view_unassigned=false
 *   Member2 (TM 150) tem override explícito leads.view_all=true
 *
 * Fixture montada aqui:
 *   - mensagens de WhatsApp para os quatro telefones acima
 *   - um telefone ÓRFÃO, sem lead nenhum na org
 *   - Org B: lead 2001 recebe Member B como pre_sale; Member B NÃO tem
 *     override nenhum — é o caso que prova que, com a política ligada, o
 *     default global (leads.view_all=true) deixa de valer.
 *
 * Prerequisites: `supabase start` + `supabase db reset`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getOrgAMember2,
  getOrgBMember,
  getMaster,
  clearClients,
  createServiceClient,
} from './rls-helpers';
import { TEST_ORG_ID, TEST_ORG_B_ID, TEST_TM_MEMBER_B_ID } from './setup';

const PHONE_ALPHA = '11999990001';
const PHONE_BETA = '11999990002';
const PHONE_GAMMA = '11999990003';
const PHONE_DELTA = '11999990004';
/** Telefone sem lead correspondente em nenhuma org. */
const PHONE_ORFA = '11988880000';
const PHONE_ORGB_1 = '11999990101';

const ALL_ORG_A_PHONES = [PHONE_ALPHA, PHONE_BETA, PHONE_GAMMA, PHONE_DELTA, PHONE_ORFA];

const LEAD_ALPHA = '00000000-0000-0000-0000-000000001001';
const LEAD_BETA = '00000000-0000-0000-0000-000000001002';
const AGENT_ID = '00000000-0000-0000-0000-00000000ca01';
const CONV_ALPHA = '00000000-0000-0000-0000-00000000cb01';
const CONV_BETA = '00000000-0000-0000-0000-00000000cb02';

const MSG_PREFIX = 'isolation-test-';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

// ---------------------------------------------------------------------------
// Gate de escrita do proxy (#1635)
//
// Vive NESTE arquivo, e não num separado, porque compartilha a mesma política
// de org: dois arquivos ligando e desligando chat_restrict_to_owner na Org A
// em paralelo corrompem um ao outro — o vitest roda arquivos concorrentes.
//
// `supabase start` já sobe o edge runtime montando supabase/functions, então
// na prática a função está servida e o código local vale sem passo extra.
// A sonda existe para CI ou ambiente onde o runtime não esteja de pé: ali este
// bloco se pula sozinho em vez de falhar por indisponibilidade.
// ---------------------------------------------------------------------------

const PROXY_URL =
  process.env.PROXY_URL ?? 'http://127.0.0.1:54321/functions/v1/whatsapp-api-proxy';
const INSTANCE_ID = '00000000-0000-0000-0000-0000000000f1';
/**
 * O bloco do proxy é um `describe` IRMÃO, não aninhado — o afterAll do de cima
 * já apagou INSTANCE_ID quando ele começa. Instância própria, ciclo próprio.
 */
const PROXY_INSTANCE_ID = '00000000-0000-0000-0000-0000000000f2';
const MSG_ALPHA = 'proxy-guard-alpha';
const MSG_BETA = 'proxy-guard-beta';

let proxyServed = false;
try {
  const probe = await fetch(PROXY_URL, { method: 'POST', body: '{}' });
  proxyServed = probe.status !== 404;
} catch {
  proxyServed = false;
}

async function tokenOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error('sem access_token — cliente não autenticado');
  return t;
}

async function call(token: string, action: string, payload: Record<string, unknown>) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, instance_id: PROXY_INSTANCE_ID, payload }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* corpo não-JSON: o que importa é o status */
  }
  return { status: res.status, body };
}

/** O gate recusou? Distinto do 403 de fronteira de org e do 403 de plano. */
function blockedByGuard(r: { status: number; body: Record<string, unknown> }): boolean {
  return r.status === 403 && r.body.reason === 'chat_owner';
}


/** Telefones que este cliente consegue ler em whatsapp_messages. */
async function visiblePhones(client: SupabaseClient, orgId: string): Promise<string[]> {
  const { data, error } = await client
    .from('whatsapp_messages')
    .select('normalized_phone')
    .eq('organization_id', orgId)
    .like('message_id', `${MSG_PREFIX}%`);
  if (error) throw new Error(`SELECT whatsapp_messages falhou: ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.normalized_phone as string))].sort();
}

async function setPolicy(service: SupabaseClient, orgId: string, enabled: boolean) {
  const { error } = await service
    .from('organizations')
    .update({ chat_restrict_to_owner: enabled })
    .eq('id', orgId);
  if (error) throw new Error(`Falha ao ajustar a política: ${error.message}`);
}

describe.skipIf(shouldSkip)('Chat: isolamento por responsável', () => {
  let service: SupabaseClient;
  let admin: SupabaseClient;
  let member1: SupabaseClient;
  let member2: SupabaseClient;
  let memberB: SupabaseClient;
  let master: SupabaseClient;

  beforeAll(async () => {
    [admin, member1, member2, memberB, master] = await Promise.all([
      getOrgAAdmin(),
      getOrgAMember1(),
      getOrgAMember2(),
      getOrgBMember(),
      getMaster(),
    ]);
    service = createServiceClient();

    // A instância vive no beforeAll EXTERNO porque toda mensagem precisa dela:
    // o trigger que alimenta whatsapp_conversation_summary ignora linha com
    // instance_id nulo, e é dessa tabela que a prévia (#1636) conta. Mensagem
    // sem instância também não existe em produção.
    //
    // A cota é 0/0 no plano free e o trigger recusa o INSERT — daí o
    // limit_overrides, que sai no afterAll.
    await service
      .from('organizations')
      .update({ limit_overrides: { max_whatsapp_instances: 5, max_copilot_agents: 5 } })
      .eq('id', TEST_ORG_ID);

    const { error: instErr } = await service.from('whatsapp_instances').upsert({
      id: INSTANCE_ID,
      organization_id: TEST_ORG_ID,
      instance_name: 'isolation-fixture',
      status: 'connected',
    });
    if (instErr) throw new Error(`Falha ao semear a instância: ${instErr.message}`);

    // Member B passa a ser responsável do lead OrgB-1, sem nenhum override de
    // permissão — é o controle do caso "membro sem override".
    await service
      .from('leads')
      .update({ pre_sale_responsible_id: TEST_TM_MEMBER_B_ID })
      .eq('id', '00000000-0000-0000-0000-000000002001');

    const rows = [
      ...ALL_ORG_A_PHONES.map((phone) => ({
        organization_id: TEST_ORG_ID,
        instance_id: INSTANCE_ID,
        message_id: `${MSG_PREFIX}a-${phone}`,
        remote_jid: `${phone}@s.whatsapp.net`,
        phone_number: `+55${phone}`,
        normalized_phone: phone,
        direction: 'incoming',
        content: `mensagem de ${phone}`,
      })),
      {
        organization_id: TEST_ORG_B_ID,
        message_id: `${MSG_PREFIX}b-${PHONE_ORGB_1}`,
        remote_jid: `${PHONE_ORGB_1}@s.whatsapp.net`,
        phone_number: `+55${PHONE_ORGB_1}`,
        normalized_phone: PHONE_ORGB_1,
        direction: 'incoming',
        content: 'mensagem org B',
      },
    ];
    const { error } = await service.from('whatsapp_messages').insert(rows);
    if (error) throw new Error(`Falha ao semear whatsapp_messages: ${error.message}`);

    // O agente do Copilot e as conversas vivem AQUI, não na seed:
    // rls-org-isolation afirma que `copilot_agents` da Org A tem 0 linhas, e um
    // agente permanente na seed quebra essa asserção de isolamento cross-tenant.
    //
    // A cota de agentes é 0/0 no plano free e o trigger recusa o INSERT — daí o
    // limit_overrides, que sai junto no afterAll.
    await service
      .from('organizations')
      .update({ limit_overrides: { max_whatsapp_instances: 5, max_copilot_agents: 5 } })
      .eq('id', TEST_ORG_ID);

    const { error: agentErr } = await service.from('copilot_agents').upsert({
      id: AGENT_ID,
      organization_id: TEST_ORG_ID,
      created_by: '00000000-0000-0000-0000-000000000020',
      name: 'Agente de teste (isolamento)',
      main_objective: 'fixture',
    });
    if (agentErr) throw new Error(`Falha ao semear copilot_agents: ${agentErr.message}`);

    const { error: convErr } = await service.from('conversations').upsert([
      { id: CONV_ALPHA, organization_id: TEST_ORG_ID, lead_id: LEAD_ALPHA, agent_id: AGENT_ID },
      { id: CONV_BETA, organization_id: TEST_ORG_ID, lead_id: LEAD_BETA, agent_id: AGENT_ID },
    ]);
    if (convErr) throw new Error(`Falha ao semear conversations: ${convErr.message}`);

    const { error: cmErr } = await service.from('conversation_messages').insert([
      { conversation_id: CONV_ALPHA, role: 'user', content: `${MSG_PREFIX}copilot-alpha` },
      { conversation_id: CONV_BETA, role: 'user', content: `${MSG_PREFIX}copilot-beta` },
    ]);
    if (cmErr) throw new Error(`Falha ao semear conversation_messages: ${cmErr.message}`);

    await setPolicy(service, TEST_ORG_ID, false);
    await setPolicy(service, TEST_ORG_B_ID, false);
  });

  afterAll(async () => {
    await service.from('whatsapp_messages').delete().like('message_id', `${MSG_PREFIX}%`);
    await service.from('conversation_messages').delete().like('content', `${MSG_PREFIX}%`);
    await service.from('conversations').delete().eq('agent_id', AGENT_ID);
    await service.from('copilot_agents').delete().eq('id', AGENT_ID);
    await service.from('whatsapp_instances').delete().eq('id', INSTANCE_ID);
    await service.from('organizations').update({ limit_overrides: {} }).eq('id', TEST_ORG_ID);
    await service
      .from('leads')
      .update({ pre_sale_responsible_id: null })
      .eq('id', '00000000-0000-0000-0000-000000002001');
    await setPolicy(service, TEST_ORG_ID, false);
    await setPolicy(service, TEST_ORG_B_ID, false);
    await clearClients();
  });

  // ---------------------------------------------------------------
  // Política DESLIGADA — comportamento de hoje, para as 102 orgs que
  // não pediram nada. É a garantia de não-regressão.
  // ---------------------------------------------------------------

  describe('política desligada (no-op)', () => {
    beforeAll(async () => {
      await setPolicy(service, TEST_ORG_ID, false);
    });

    it('membro lê as conversas de toda a org — controle positivo', async () => {
      expect(await visiblePhones(member1, TEST_ORG_ID)).toEqual([...ALL_ORG_A_PHONES].sort());
    });

    it('admin lê as conversas de toda a org', async () => {
      expect(await visiblePhones(admin, TEST_ORG_ID)).toEqual([...ALL_ORG_A_PHONES].sort());
    });

    it('membro não alcança a conversa de outra org', async () => {
      expect(await visiblePhones(member1, TEST_ORG_B_ID)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // Política LIGADA
  // ---------------------------------------------------------------

  describe('política ligada', () => {
    beforeAll(async () => {
      await setPolicy(service, TEST_ORG_ID, true);
    });

    it('membro lê a conversa do lead em que é pre_sale', async () => {
      expect(await visiblePhones(member1, TEST_ORG_ID)).toContain(PHONE_ALPHA);
    });

    it('membro lê a conversa do lead em que é sale', async () => {
      expect(await visiblePhones(member2, TEST_ORG_ID)).toContain(PHONE_BETA);
    });

    it('membro lê a conversa do lead em que é sdr', async () => {
      // Delta tem sdr = Member1 e closer = Member2; ambos leem.
      expect(await visiblePhones(member1, TEST_ORG_ID)).toContain(PHONE_DELTA);
    });

    it('membro lê a conversa do lead em que é closer', async () => {
      expect(await visiblePhones(member2, TEST_ORG_ID)).toContain(PHONE_DELTA);
    });

    it('membro NÃO lê a conversa de lead de outro responsável', async () => {
      expect(await visiblePhones(member1, TEST_ORG_ID)).not.toContain(PHONE_BETA);
    });

    it('membro sem permissão de não-atribuídos NÃO lê conversa de lead sem responsável', async () => {
      expect(await visiblePhones(member1, TEST_ORG_ID)).not.toContain(PHONE_GAMMA);
    });

    it('membro NÃO lê conversa de telefone sem lead', async () => {
      expect(await visiblePhones(member1, TEST_ORG_ID)).not.toContain(PHONE_ORFA);
    });

    it('membro vê exatamente as conversas dos seus leads', async () => {
      expect(await visiblePhones(member1, TEST_ORG_ID)).toEqual([PHONE_ALPHA, PHONE_DELTA].sort());
    });

    it('membro com exceção nominal lê tudo da org, inclusive órfã', async () => {
      // Member2 tem override explícito leads.view_all=true.
      expect(await visiblePhones(member2, TEST_ORG_ID)).toEqual([...ALL_ORG_A_PHONES].sort());
    });

    it('admin lê tudo da org', async () => {
      expect(await visiblePhones(admin, TEST_ORG_ID)).toEqual([...ALL_ORG_A_PHONES].sort());
    });

    it('master lê tudo da org', async () => {
      expect(await visiblePhones(master, TEST_ORG_ID)).toEqual([...ALL_ORG_A_PHONES].sort());
    });
  });

  // ---------------------------------------------------------------
  // O caso que faz membro recém-contratado nascer restrito.
  // ---------------------------------------------------------------

  describe('membro sem override nenhum (Org B)', () => {
    beforeAll(async () => {
      await setPolicy(service, TEST_ORG_B_ID, true);
    });

    it('lê a conversa do lead de que é responsável — controle positivo', async () => {
      expect(await visiblePhones(memberB, TEST_ORG_B_ID)).toContain(PHONE_ORGB_1);
    });

    it('o default global leads.view_all=true NÃO abre a visão quando a política está ligada', async () => {
      // Sem linha em member_feature_permissions, has_feature_permission()
      // devolveria true pelo default do catálogo. Com a política ligada, só
      // override EXPLÍCITO abre — senão todo contratado novo nasce vendo tudo.
      const { data } = await memberB.rpc('has_feature_permission', {
        p_feature_key: 'leads.view_all',
      });
      expect(data).toBe(true); // o default global continua true...
      // ...e ainda assim a conversa alheia não aparece:
      expect(await visiblePhones(memberB, TEST_ORG_B_ID)).toEqual([PHONE_ORGB_1]);
    });
  });

  // ---------------------------------------------------------------
  // Interação com a camada de default por org (#1630)
  // ---------------------------------------------------------------

  describe('default da org NÃO abre o chat restrito', () => {
    beforeAll(async () => {
      await setPolicy(service, TEST_ORG_B_ID, true);
    });

    afterAll(async () => {
      await service
        .from('organization_feature_defaults')
        .delete()
        .eq('organization_id', TEST_ORG_B_ID);
    });

    it('org default leads.view_all=true não faz o membro ver conversa alheia', async () => {
      // Com a política de chat ligada, SÓ override explícito no membro abre a
      // visão. Um default da ORG é um default — se ele abrisse, a política de
      // isolamento seria desfeita pelo mesmo mecanismo que ela existe para
      // corrigir, e ninguém perceberia.
      expect(await visiblePhones(memberB, TEST_ORG_B_ID)).toEqual([PHONE_ORGB_1]); // controle positivo

      await service
        .from('organization_feature_defaults')
        .upsert(
          { organization_id: TEST_ORG_B_ID, feature_key: 'leads.view_all', enabled: true },
          { onConflict: 'organization_id,feature_key' },
        );

      expect(await visiblePhones(memberB, TEST_ORG_B_ID)).toEqual([PHONE_ORGB_1]);
    });
  });

  // ---------------------------------------------------------------
  // Reatribuição
  // ---------------------------------------------------------------

  describe('reatribuição move a conversa', () => {
    beforeAll(async () => {
      await setPolicy(service, TEST_ORG_ID, true);
    });

    it('transferir o lead passa o histórico ao novo responsável e o tira do anterior', async () => {
      const alphaId = '00000000-0000-0000-0000-000000001001';
      const TM_MEMBER_2 = '00000000-0000-0000-0000-000000000150';
      const TM_MEMBER_1 = '00000000-0000-0000-0000-000000000140';

      expect(await visiblePhones(member1, TEST_ORG_ID)).toContain(PHONE_ALPHA);

      await service
        .from('leads')
        .update({ pre_sale_responsible_id: TM_MEMBER_2, sdr_id: TM_MEMBER_2 })
        .eq('id', alphaId);

      try {
        expect(await visiblePhones(member1, TEST_ORG_ID)).not.toContain(PHONE_ALPHA);
        expect(await visiblePhones(member2, TEST_ORG_ID)).toContain(PHONE_ALPHA);
      } finally {
        await service
          .from('leads')
          .update({ pre_sale_responsible_id: TM_MEMBER_1, sdr_id: TM_MEMBER_1 })
          .eq('id', alphaId);
      }
    });
  });

  // ---------------------------------------------------------------
  // UPDATE segue a mesma regra do SELECT.
  //
  // whatsapp_messages_update_org é org-wide em produção
  // (organization_id = get_user_organization_id()) e faz OR com a restritiva
  // ao lado — a mesma armadilha do SELECT, um andar abaixo.
  // ---------------------------------------------------------------

  describe('UPDATE segue a regra', () => {
    beforeAll(async () => {
      await setPolicy(service, TEST_ORG_ID, true);
    });

    it('membro edita a mensagem do próprio lead — controle positivo', async () => {
      const { data, error } = await member1
        .from('whatsapp_messages')
        .update({ content: 'editado pelo dono' })
        .eq('message_id', `${MSG_PREFIX}a-${PHONE_ALPHA}`)
        .select('id');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('membro NÃO edita a mensagem do lead de outro responsável', async () => {
      // SEM .select(). Com RETURNING o Postgres também aplica a policy de
      // SELECT, e o teste passaria mesmo com a policy de UPDATE escancarada —
      // verde pelo motivo errado. A verificação real é ler a linha depois,
      // pelo service client, e conferir que o conteúdo não mudou.
      const { error } = await member1
        .from('whatsapp_messages')
        .update({ content: 'invasao' })
        .eq('message_id', `${MSG_PREFIX}a-${PHONE_BETA}`);

      expect(error).toBeNull();

      const { data: check } = await service
        .from('whatsapp_messages')
        .select('content')
        .eq('message_id', `${MSG_PREFIX}a-${PHONE_BETA}`)
        .single();
      expect(check!.content).not.toBe('invasao');
    });
  });

  // ---------------------------------------------------------------
  // As outras três portas para o mesmo conteúdo.
  //
  // conversation_messages é o histórico do Copilot com o lead — mesmo
  // conteúdo do chat, outra tabela. channel_messages é o inbound de
  // Meta/Instagram. Fechar o inbox e deixar essas abertas é vender uma
  // permissão que não cumpre o que promete.
  // ---------------------------------------------------------------

  describe('Copilot e Meta seguem a mesma regra', () => {
    beforeAll(async () => {
      await setPolicy(service, TEST_ORG_ID, true);
    });

    it('membro lê a conversa do Copilot do próprio lead — controle positivo', async () => {
      const { data, error } = await member1.from('conversations').select('lead_id');
      expect(error).toBeNull();
      expect(data!.map((r) => r.lead_id)).toContain(LEAD_ALPHA);
    });

    it('membro NÃO lê a conversa do Copilot de lead alheio', async () => {
      const { data } = await member1.from('conversations').select('lead_id');
      expect(data!.map((r) => r.lead_id)).not.toContain(LEAD_BETA);
    });

    it('membro NÃO lê as mensagens do Copilot de lead alheio', async () => {
      const { data } = await member1
        .from('conversation_messages')
        .select('content')
        .like('content', `${MSG_PREFIX}%`);
      expect(data!.map((r) => r.content)).toContain(`${MSG_PREFIX}copilot-alpha`);
      expect(data!.map((r) => r.content)).not.toContain(`${MSG_PREFIX}copilot-beta`);
    });

    it('membro NÃO lê o canal Meta de lead alheio', async () => {
      const { data } = await member1
        .from('channel_messages')
        .select('external_id')
        .like('external_id', `${MSG_PREFIX}%`);
      expect(data!.map((r) => r.external_id)).toContain(`${MSG_PREFIX}meta-alpha`);
      expect(data!.map((r) => r.external_id)).not.toContain(`${MSG_PREFIX}meta-beta`);
    });

    it('admin lê as três tabelas por inteiro', async () => {
      const [c, cm, ch] = await Promise.all([
        admin.from('conversations').select('lead_id'),
        admin.from('conversation_messages').select('content').like('content', `${MSG_PREFIX}%`),
        admin.from('channel_messages').select('external_id').like('external_id', `${MSG_PREFIX}%`),
      ]);
      expect(c.data!.map((r) => r.lead_id).sort()).toEqual([LEAD_ALPHA, LEAD_BETA].sort());
      expect(cm.data).toHaveLength(2);
      expect(ch.data).toHaveLength(2);
    });

    it('com a política desligada as três voltam a ser org-wide — no-op', async () => {
      await setPolicy(service, TEST_ORG_ID, false);
      try {
        const [c, cm, ch] = await Promise.all([
          member1.from('conversations').select('lead_id'),
          member1.from('conversation_messages').select('content').like('content', `${MSG_PREFIX}%`),
          member1.from('channel_messages').select('external_id').like('external_id', `${MSG_PREFIX}%`),
        ]);
        expect(c.data!.map((r) => r.lead_id).sort()).toEqual([LEAD_ALPHA, LEAD_BETA].sort());
        expect(cm.data).toHaveLength(2);
        expect(ch.data).toHaveLength(2);
      } finally {
        await setPolicy(service, TEST_ORG_ID, true);
      }
    });
  });

  // ---------------------------------------------------------------
  // A prévia que o admin vê ANTES de ligar (#1636)
  //
  // Os números saem de whatsapp_conversation_summary (uma linha por org+chip+
  // telefone, 46.611 em produção) e não de whatsapp_messages (2.472.395). Uma
  // prévia que varre a tabela de mensagens trava a tela justamente na org
  // grande, que é onde a decisão importa.
  // ---------------------------------------------------------------

  describe('prévia da política', () => {
    it('conta as conversas da org e quantas ficariam restritas', async () => {
      // Fixture da Org A, 5 conversas individuais:
      //   Alpha  — lead com dono (Member1)        → continua visível
      //   Beta   — lead com dono (Member2)        → continua visível
      //   Delta  — lead com dono (ambos)          → continua visível
      //   Gamma  — lead SEM responsável           → restrita
      //   órfã   — telefone sem lead nenhum       → restrita
      const { data, error } = await admin.rpc('preview_chat_restriction', {
        p_org_id: TEST_ORG_ID,
      });

      expect(error).toBeNull();
      expect(data).toMatchObject({
        conversas_total: 5,
        conversas_restritas: 2,
        leads_sem_responsavel: 1, // só o Gamma
      });
    });

    it('master consulta qualquer org', async () => {
      const { data, error } = await master.rpc('preview_chat_restriction', {
        p_org_id: TEST_ORG_ID,
      });
      expect(error).toBeNull();
      expect((data as any).conversas_total).toBe(5);
    });

    it('membro NÃO consulta a prévia', async () => {
      const { error } = await member1.rpc('preview_chat_restriction', {
        p_org_id: TEST_ORG_ID,
      });
      expect(error).not.toBeNull();
    });

    it('admin de uma org NÃO consulta a prévia de outra', async () => {
      const { error } = await admin.rpc('preview_chat_restriction', {
        p_org_id: TEST_ORG_B_ID,
      });
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // O interruptor: quem escreve
  // ---------------------------------------------------------------

  describe('RPC de escrita da política', () => {
    it('admin da org liga e desliga', async () => {
      const { error: onErr } = await admin.rpc('set_org_chat_restriction', {
        p_org_id: TEST_ORG_ID,
        p_enabled: true,
      });
      expect(onErr).toBeNull();

      const { data: after } = await service
        .from('organizations')
        .select('chat_restrict_to_owner')
        .eq('id', TEST_ORG_ID)
        .single();
      expect(after!.chat_restrict_to_owner).toBe(true);
    });

    it('membro NÃO liga a política', async () => {
      const { error } = await member1.rpc('set_org_chat_restriction', {
        p_org_id: TEST_ORG_ID,
        p_enabled: false,
      });
      expect(error).not.toBeNull();
    });

    it('admin de outra org NÃO liga a política da Org A', async () => {
      const { error } = await memberB.rpc('set_org_chat_restriction', {
        p_org_id: TEST_ORG_ID,
        p_enabled: false,
      });
      expect(error).not.toBeNull();
    });
  });
});

describe.skipIf(!proxyServed)('gate de escrita no whatsapp-api-proxy', () => {
  let service: SupabaseClient;
  let memberToken: string;
  let adminToken: string;

  beforeAll(async () => {
    service = createServiceClient();
    const [member1, admin] = await Promise.all([getOrgAMember1(), getOrgAAdmin()]);
    memberToken = await tokenOf(member1);
    adminToken = await tokenOf(admin);

    await service
      .from('organizations')
      .update({ limit_overrides: { max_whatsapp_instances: 5 } })
      .eq('id', TEST_ORG_ID);

    const { error: instErr } = await service.from('whatsapp_instances').upsert({
      id: PROXY_INSTANCE_ID,
      organization_id: TEST_ORG_ID,
      instance_name: 'proxy-guard-fixture',
      status: 'connected',
    });
    if (instErr) throw new Error(`Falha ao semear a instância: ${instErr.message}`);

    await service.from('whatsapp_messages').upsert(
      [
        { phone: PHONE_ALPHA, mid: MSG_ALPHA },
        { phone: PHONE_BETA, mid: MSG_BETA },
      ].map(({ phone, mid }) => ({
        organization_id: TEST_ORG_ID,
        instance_id: PROXY_INSTANCE_ID,
        message_id: mid,
        remote_jid: `${phone}@s.whatsapp.net`,
        phone_number: `+55${phone}`,
        normalized_phone: phone,
        direction: 'incoming',
        content: mid,
      })),
      { onConflict: 'message_id,instance_id' },
    );

    await service
      .from('organizations')
      .update({ chat_restrict_to_owner: true })
      .eq('id', TEST_ORG_ID);
  });

  afterAll(async () => {
    await service.from('whatsapp_messages').delete().in('message_id', [MSG_ALPHA, MSG_BETA]);
    await service.from('whatsapp_instances').delete().eq('id', PROXY_INSTANCE_ID);
    await service.from('organizations').update({ limit_overrides: {} }).eq('id', TEST_ORG_ID);
    await service
      .from('organizations')
      .update({ chat_restrict_to_owner: false })
      .eq('id', TEST_ORG_ID);
    await clearClients();
  });

  it('membro envia para o telefone do próprio lead — controle positivo', async () => {
    const r = await call(memberToken, 'sendText', { number: PHONE_ALPHA, text: 'oi' });
    // "não foi bloqueado pelo gate" sozinho é fraco: passaria também se a
    // chamada morresse no gate de plano ou na fronteira de org, que também
    // devolvem 403. Exigir NENHUM 403 prova a travessia.
    //
    // Medido: com o lead próprio a chamada chega ao provider e devolve 500
    // "EVOLUTION_API_URL env not set" — a Uazapi não está configurada no
    // ambiente de teste, e é esse erro que prova que o gate deixou passar.
    expect(r.status).not.toBe(403);
  });

  it('membro NÃO envia para o telefone do lead alheio', async () => {
    const r = await call(memberToken, 'sendText', { number: PHONE_BETA, text: 'oi' });
    expect(blockedByGuard(r)).toBe(true);
  });

  it('membro NÃO reage a mensagem do lead alheio', async () => {
    const r = await call(memberToken, 'react', {
      message_id: MSG_BETA,
      number: PHONE_BETA,
      emoji: '👍',
    });
    expect(blockedByGuard(r)).toBe(true);
  });

  it('membro NÃO marca como lida mensagem do lead alheio (só message_id, sem number)', async () => {
    const r = await call(memberToken, 'markRead', { message_id: MSG_BETA });
    expect(blockedByGuard(r)).toBe(true);
  });

  it('membro NÃO baixa mídia de mensagem do lead alheio (só message_id)', async () => {
    const r = await call(memberToken, 'downloadMedia', { message_id: MSG_BETA });
    expect(blockedByGuard(r)).toBe(true);
  });

  it('membro NÃO sincroniza histórico do lead alheio (chat_jid)', async () => {
    const r = await call(memberToken, 'historySync', {
      chat_jid: `${PHONE_BETA}@s.whatsapp.net`,
    });
    expect(blockedByGuard(r)).toBe(true);
  });

  it('membro NÃO apaga mensagem do lead alheio', async () => {
    const r = await call(memberToken, 'deleteMessage', {
      message_id: MSG_BETA,
      number: PHONE_BETA,
    });
    expect(blockedByGuard(r)).toBe(true);
  });

  it('admin age em qualquer conversa da org', async () => {
    const r = await call(adminToken, 'sendText', { number: PHONE_BETA, text: 'oi' });
    expect(r.status).not.toBe(403);
  });

  it('ação que não toca conversa passa sem o gate', async () => {
    const r = await call(memberToken, 'getStatus', {});
    expect(r.status).not.toBe(403);
  });

  it('com a política desligada nada é bloqueado — no-op', async () => {
    await service
      .from('organizations')
      .update({ chat_restrict_to_owner: false })
      .eq('id', TEST_ORG_ID);
    try {
      const r = await call(memberToken, 'sendText', { number: PHONE_BETA, text: 'oi' });
      expect(r.status).not.toBe(403);
    } finally {
      await service
        .from('organizations')
        .update({ chat_restrict_to_owner: true })
        .eq('id', TEST_ORG_ID);
    }
  });
});
