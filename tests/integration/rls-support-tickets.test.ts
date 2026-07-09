// @vitest-environment node
/**
 * RLS do Chamado (support_tickets + support_ticket_comments) — ADR-0018.
 *
 * A matriz que este arquivo protege:
 *
 *   autor        lê os seus chamados
 *   admin da org lê todos da org  (o funcionário demitido não leva o chamado)
 *   outro membro NÃO lê chamado que não autorou
 *   outra org    não lê nada
 *   master       lê tudo, e é o ÚNICO que lê comentário interno
 *
 * O filtro de `is_internal` mora na policy, não no frontend. Uma nota interna
 * vazada é um incidente, não um bug de tela — por isso ela é verificada aqui,
 * contra a API, e não contra um componente.
 *
 * Nada aqui usa `service_role`: os fixtures são criados através das próprias
 * policies. Se a montagem do cenário falhar, isso já é um resultado.
 *
 * Duas armadilhas que o desenho evita, e que estes testes travam:
 *
 *   1. Um UPDATE barrado por RLS **não devolve erro** — o Postgres atualiza
 *      zero linhas e o PostgREST responde 200. Por isso `severidade`, `tipo` e
 *      `support_context` são protegidos por trigger, que levanta exceção.
 *
 *   2. `master@test.com` é master e NÃO é membro ativo de nenhuma org. Se ele
 *      fosse admin da org A, as asserções de "o master lê" passariam pelo
 *      caminho de admin e não provariam nada sobre `is_master_user()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getOrgAMember2,
  getOrgBAdmin,
  getOrgBMember,
  getMaster,
  clearClients,
} from './rls-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const ORG_A = '00000000-0000-0000-0000-000000000001';

describe.skipIf(shouldSkip)('RLS: Chamado (support_tickets)', () => {
  let adminA: SupabaseClient;
  let member1A: SupabaseClient;
  let member2A: SupabaseClient;
  let adminB: SupabaseClient;
  let memberB: SupabaseClient;
  let master: SupabaseClient;

  let member1UserId: string;
  let masterUserId: string;

  let ticketId: string;
  let publicCommentId: string;
  let internalCommentId: string;

  beforeAll(async () => {
    [adminA, member1A, member2A, adminB, memberB, master] = await Promise.all([
      getOrgAAdmin(),
      getOrgAMember1(),
      getOrgAMember2(),
      getOrgBAdmin(),
      getOrgBMember(),
      getMaster(),
    ]);

    member1UserId = (await member1A.auth.getUser()).data.user!.id;
    masterUserId = (await master.auth.getUser()).data.user!.id;

    // O autor abre o próprio chamado — pela policy, como um usuário real.
    const { data: ticket, error } = await member1A
      .from('support_tickets')
      .insert({
        organization_id: ORG_A,
        author_user_id: member1UserId,
        title: 'Kanban trava ao arrastar card',
        description: 'Ao arrastar de abordado para respondeu, a tela congela.',
        tipo: 'bug',
        impacto: 'parado',
        support_context: { route: '/oportunidades', app_version: 'sha-test' },
      })
      .select('id')
      .single();
    if (error) throw new Error(`fixture ticket: ${error.message}`);
    ticketId = ticket!.id;

    const { data: pub, error: pubErr } = await member1A
      .from('support_ticket_comments')
      .insert({ ticket_id: ticketId, author_user_id: member1UserId, body: 'Acontece toda vez.' })
      .select('id')
      .single();
    if (pubErr) throw new Error(`fixture comentario publico: ${pubErr.message}`);
    publicCommentId = pub!.id;

    const { data: internal, error: intErr } = await master
      .from('support_ticket_comments')
      .insert({
        ticket_id: ticketId,
        author_user_id: masterUserId,
        body: 'Provavelmente o stage_cap. Nao mostrar ao cliente.',
        is_internal: true,
      })
      .select('id')
      .single();
    if (intErr) throw new Error(`fixture comentario interno: ${intErr.message}`);
    internalCommentId = internal!.id;
  });

  afterAll(async () => {
    // Chamado não se apaga — exceto pelo master, que é quem limpa a bancada.
    await master.from('support_tickets').delete().eq('id', ticketId);
    await clearClients();
  });

  const ticketIdsVisibleTo = async (client: SupabaseClient) => {
    const { data } = await client.from('support_tickets').select('id');
    return (data ?? []).map((r) => r.id as string);
  };

  const commentIdsVisibleTo = async (client: SupabaseClient) => {
    const { data } = await client.from('support_ticket_comments').select('id');
    return (data ?? []).map((r) => r.id as string);
  };

  // ---------------------------------------------------------------------------

  describe('SELECT em support_tickets', () => {
    it('o autor lê o próprio chamado', async () => {
      expect(await ticketIdsVisibleTo(member1A)).toContain(ticketId);
    });

    it('o admin da org lê o chamado de um membro', async () => {
      expect(await ticketIdsVisibleTo(adminA)).toContain(ticketId);
    });

    it('outro membro da mesma org NÃO lê chamado que não autorou', async () => {
      expect(await ticketIdsVisibleTo(member2A)).not.toContain(ticketId);
    });

    it('o admin de outra org não lê nada da org A', async () => {
      expect(await ticketIdsVisibleTo(adminB)).not.toContain(ticketId);
    });

    it('um membro de outra org não lê nada da org A', async () => {
      expect(await ticketIdsVisibleTo(memberB)).not.toContain(ticketId);
    });

    it('o master lê o chamado de qualquer org, sem ser membro dela', async () => {
      expect(await ticketIdsVisibleTo(master)).toContain(ticketId);
    });
  });

  describe('INSERT em support_tickets', () => {
    it('qualquer membro autenticado abre chamado na própria org', async () => {
      const uid = (await member2A.auth.getUser()).data.user!.id;
      const { data, error } = await member2A
        .from('support_tickets')
        .insert({
          organization_id: ORG_A,
          author_user_id: uid,
          title: 'Duvida sobre funil',
          tipo: 'duvida',
          impacto: 'incomodo',
        })
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      await master.from('support_tickets').delete().eq('id', data!.id);
    });

    it('um membro não abre chamado em nome de outra organização', async () => {
      const uid = (await memberB.auth.getUser()).data.user!.id;
      const { error } = await memberB.from('support_tickets').insert({
        organization_id: ORG_A,
        author_user_id: uid,
        title: 'Tentativa cross-tenant',
        tipo: 'duvida',
        impacto: 'incomodo',
      });
      expect(error).not.toBeNull();
    });

    it('um membro não abre chamado se passando por outro usuário', async () => {
      const { error } = await member2A.from('support_tickets').insert({
        organization_id: ORG_A,
        author_user_id: member1UserId,
        title: 'Autor forjado',
        tipo: 'duvida',
        impacto: 'incomodo',
      });
      expect(error).not.toBeNull();
    });

    // O usuário sabe se está parado. Não sabe se é crítico — isso depende de
    // quantas OUTRAS orgs foram atingidas, informação que só a Torque tem.
    it('o cliente não define severidade na abertura', async () => {
      const uid = (await member2A.auth.getUser()).data.user!.id;
      const { error } = await member2A.from('support_tickets').insert({
        organization_id: ORG_A,
        author_user_id: uid,
        title: 'Tudo critico sempre',
        tipo: 'bug',
        impacto: 'parado',
        severidade: 'critica',
      });
      expect(error).not.toBeNull();
    });
  });

  describe('UPDATE em support_tickets', () => {
    it('o autor não define a severidade', async () => {
      const { error } = await member1A
        .from('support_tickets')
        .update({ severidade: 'critica' })
        .eq('id', ticketId);
      expect(error).not.toBeNull();
    });

    it('o admin da org não define a severidade', async () => {
      const { error } = await adminA
        .from('support_tickets')
        .update({ severidade: 'critica' })
        .eq('id', ticketId);
      expect(error).not.toBeNull();
    });

    it('o cliente não corrige o tipo — a triagem é do suporte', async () => {
      const { error } = await member1A
        .from('support_tickets')
        .update({ tipo: 'duvida' })
        .eq('id', ticketId);
      expect(error).not.toBeNull();
    });

    it('o master define a severidade', async () => {
      const { error } = await master
        .from('support_tickets')
        .update({ severidade: 'alta' })
        .eq('id', ticketId);
      expect(error).toBeNull();
    });

    it('o master corrige o tipo de um chamado', async () => {
      const { error } = await master
        .from('support_tickets')
        .update({ tipo: 'duvida' })
        .eq('id', ticketId);
      expect(error).toBeNull();
      await master.from('support_tickets').update({ tipo: 'bug' }).eq('id', ticketId);
    });
  });

  describe('support_context', () => {
    it('não pode ser reescrito, nem pelo master', async () => {
      const { error } = await master
        .from('support_tickets')
        .update({ support_context: { route: '/forjado' } })
        .eq('id', ticketId);
      expect(error).not.toBeNull();
    });

    it('sobrevive intacto a um update de outro campo', async () => {
      await master.from('support_tickets').update({ status: 'em_andamento' }).eq('id', ticketId);
      const { data } = await master
        .from('support_tickets')
        .select('support_context')
        .eq('id', ticketId)
        .single();
      expect((data!.support_context as Record<string, unknown>).route).toBe('/oportunidades');
      await master.from('support_tickets').update({ status: 'aberto' }).eq('id', ticketId);
    });
  });

  describe('SELECT em support_ticket_comments', () => {
    it('o autor lê o comentário público do seu chamado', async () => {
      expect(await commentIdsVisibleTo(member1A)).toContain(publicCommentId);
    });

    it('o autor NUNCA lê o comentário interno', async () => {
      expect(await commentIdsVisibleTo(member1A)).not.toContain(internalCommentId);
    });

    it('o admin da org lê o público e NUNCA o interno', async () => {
      const ids = await commentIdsVisibleTo(adminA);
      expect(ids).toContain(publicCommentId);
      expect(ids).not.toContain(internalCommentId);
    });

    it('outro membro da mesma org não lê comentário de chamado alheio', async () => {
      const ids = await commentIdsVisibleTo(member2A);
      expect(ids).not.toContain(publicCommentId);
      expect(ids).not.toContain(internalCommentId);
    });

    it('outra org não lê comentário nenhum', async () => {
      const ids = await commentIdsVisibleTo(adminB);
      expect(ids).not.toContain(publicCommentId);
      expect(ids).not.toContain(internalCommentId);
    });

    it('o master lê os dois', async () => {
      const ids = await commentIdsVisibleTo(master);
      expect(ids).toContain(publicCommentId);
      expect(ids).toContain(internalCommentId);
    });

    it('o autor não alcança o comentário interno nem pedindo pelo id', async () => {
      const { data } = await member1A
        .from('support_ticket_comments')
        .select('id, body')
        .eq('id', internalCommentId);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe('INSERT em support_ticket_comments', () => {
    it('o autor comenta no próprio chamado', async () => {
      const { data, error } = await member1A
        .from('support_ticket_comments')
        .insert({ ticket_id: ticketId, author_user_id: member1UserId, body: 'Alguma novidade?' })
        .select('id')
        .single();
      expect(error).toBeNull();
      await master.from('support_ticket_comments').delete().eq('id', data!.id);
    });

    it('o cliente não escreve um comentário interno', async () => {
      const { error } = await member1A.from('support_ticket_comments').insert({
        ticket_id: ticketId,
        author_user_id: member1UserId,
        body: 'tentando marcar como interno',
        is_internal: true,
      });
      expect(error).not.toBeNull();
    });

    it('um membro de outra org não comenta num chamado da org A', async () => {
      const uid = (await memberB.auth.getUser()).data.user!.id;
      const { error } = await memberB.from('support_ticket_comments').insert({
        ticket_id: ticketId,
        author_user_id: uid,
        body: 'cross-tenant',
      });
      expect(error).not.toBeNull();
    });

    it('outro membro da mesma org não comenta em chamado que não é dele', async () => {
      const uid = (await member2A.auth.getUser()).data.user!.id;
      const { error } = await member2A.from('support_ticket_comments').insert({
        ticket_id: ticketId,
        author_user_id: uid,
        body: 'bisbilhotando',
      });
      expect(error).not.toBeNull();
    });
  });
});
