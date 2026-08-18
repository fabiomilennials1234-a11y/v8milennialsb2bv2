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

const MSG_PREFIX = 'isolation-test-';

const shouldSkip = !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

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

    // Member B passa a ser responsável do lead OrgB-1, sem nenhum override de
    // permissão — é o controle do caso "membro sem override".
    await service
      .from('leads')
      .update({ pre_sale_responsible_id: TEST_TM_MEMBER_B_ID })
      .eq('id', '00000000-0000-0000-0000-000000002001');

    const rows = [
      ...ALL_ORG_A_PHONES.map((phone) => ({
        organization_id: TEST_ORG_ID,
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

    await setPolicy(service, TEST_ORG_ID, false);
    await setPolicy(service, TEST_ORG_B_ID, false);
  });

  afterAll(async () => {
    await service.from('whatsapp_messages').delete().like('message_id', `${MSG_PREFIX}%`);
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
