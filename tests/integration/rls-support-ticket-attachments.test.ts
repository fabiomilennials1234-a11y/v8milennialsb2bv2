// @vitest-environment node
/**
 * RLS e guardas do Anexo (support_ticket_attachments) — ADR-0022, migration
 * `20270724000000_support_attachments_on_comments.sql`.
 *
 * O Anexo pende do Comentário, e herda dele a visibilidade. A matriz que este
 * arquivo protege é a mesma de `rls-support-tickets.test.ts`, um nível abaixo:
 *
 *   autor        lê os anexos do seu chamado
 *   admin da org lê os anexos dos chamados da org
 *   outra org    não lê nada
 *   master       lê tudo, e é o ÚNICO que lê anexo interno
 *
 * O que é específico desta tabela, e por que está aqui e não no frontend:
 *
 *   1. Três verdades precisam concordar — o `is_internal` da linha, o do
 *      Comentário que ela acompanha, e o segmento `internal/` do caminho. A
 *      policy do Storage decide pelo CAMINHO, antes de qualquer tabela ser
 *      lida; se o caminho discordar da linha, é o caminho que vale. Uma
 *      divergência aqui não é inconsistência de dado, é vazamento.
 *
 *   2. Os tetos (5 por mensagem, 20 por chamado) moram em trigger, não em
 *      policy, pelo mesmo motivo do rate limit de chamados: um INSERT barrado
 *      por RLS volta 200 com zero linhas, e a recusa precisa ser barulhenta.
 *      Um teste que só olhasse `error` numa policy passaria sem testar nada.
 *
 *   3. `is_internal` do Comentário é imutável. É pré-requisito de (1): se ele
 *      virasse depois do upload, caminho e banco discordariam em silêncio.
 *      Como só o master tem policy de UPDATE em comentário, essa asserção é
 *      feita COMO MASTER — feita como cliente, ela passaria por RLS (zero
 *      linhas, sem erro) sem nunca alcançar o trigger.
 *
 * Nada aqui usa `service_role`: os fixtures são criados através das próprias
 * policies. Se a montagem do cenário falhar, isso já é um resultado.
 *
 * `master@test.com` é master e NÃO é membro ativo de nenhuma org — as asserções
 * de "o master lê" passam por `is_master_user()`, não pelo caminho de admin.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getOrgAAdmin,
  getOrgAMember1,
  getOrgAMember2,
  getOrgBAdmin,
  getOrgBMember,
  getMaster,
  expectDeleteDenied,
  clearClients,
} from './rls-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const shouldSkip =
  !process.env.SUPABASE_URL && process.env.SKIP_INTEGRATION === 'true';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const TABLE = 'support_ticket_attachments';

/**
 * O caminho é a fonte que a policy do Storage consulta: `<ticketId>/<uuid>.<ext>`
 * público, `<ticketId>/internal/<uuid>.<ext>` interno. O nome original NUNCA
 * entra aqui — lá ele viajaria na URL assinada e nos logs do Storage.
 */
const pathFor = (ticketId: string, opts?: { internal?: boolean }) =>
  opts?.internal
    ? `${ticketId}/internal/${crypto.randomUUID()}.png`
    : `${ticketId}/${crypto.randomUUID()}.png`;

const anexo = (over: Record<string, unknown>) => ({
  filename: 'print-do-kanban.png',
  mime: 'image/png',
  size_bytes: 12_345,
  ...over,
});

describe.skipIf(shouldSkip)('RLS: Anexo do Chamado (support_ticket_attachments)', () => {
  let adminA: SupabaseClient;
  let member1A: SupabaseClient;
  let member2A: SupabaseClient;
  let adminB: SupabaseClient;
  let memberB: SupabaseClient;
  let master: SupabaseClient;

  let member1UserId: string;
  let member2UserId: string;
  let masterUserId: string;

  let ticketId: string;
  let publicCommentId: string;
  let internalCommentId: string;

  let publicAttachmentId: string;
  let internalAttachmentId: string;

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
    member2UserId = (await member2A.auth.getUser()).data.user!.id;
    masterUserId = (await master.auth.getUser()).data.user!.id;

    // O autor abre o próprio chamado — pela policy, como um usuário real.
    const { data: ticket, error } = await member1A
      .from('support_tickets')
      .insert({
        organization_id: ORG_A,
        author_user_id: member1UserId,
        title: 'Kanban trava ao arrastar card',
        description: 'Segue print do momento em que congela.',
        tipo: 'bug',
        impacto: 'parado',
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

    // `from_staff` é obrigatório numa nota interna: o CHECK
    // `support_ticket_comments_internal_implies_staff` (20270124000000) recusa
    // interno sem staff. Nota interna é, por definição, do suporte.
    const { data: internal, error: intErr } = await master
      .from('support_ticket_comments')
      .insert({
        ticket_id: ticketId,
        author_user_id: masterUserId,
        body: 'Provavelmente o stage_cap. Nao mostrar ao cliente.',
        is_internal: true,
        from_staff: true,
      })
      .select('id')
      .single();
    if (intErr) throw new Error(`fixture comentario interno: ${intErr.message}`);
    internalCommentId = internal!.id;

    const { data: pubAtt, error: pubAttErr } = await member1A
      .from(TABLE)
      .insert(
        anexo({
          ticket_id: ticketId,
          comment_id: publicCommentId,
          author_user_id: member1UserId,
          path: pathFor(ticketId),
        }),
      )
      .select('id')
      .single();
    if (pubAttErr) throw new Error(`fixture anexo publico: ${pubAttErr.message}`);
    publicAttachmentId = pubAtt!.id;

    const { data: intAtt, error: intAttErr } = await master
      .from(TABLE)
      .insert(
        anexo({
          ticket_id: ticketId,
          comment_id: internalCommentId,
          author_user_id: masterUserId,
          is_internal: true,
          path: pathFor(ticketId, { internal: true }),
          filename: 'stage-cap-explode.png',
        }),
      )
      .select('id')
      .single();
    if (intAttErr) throw new Error(`fixture anexo interno: ${intAttErr.message}`);
    internalAttachmentId = intAtt!.id;
  });

  afterAll(async () => {
    // Chamado não se apaga — exceto pelo master. O CASCADE leva comentários e
    // anexos junto.
    await master.from('support_tickets').delete().eq('id', ticketId);
    await clearClients();
  });

  const attachmentIdsVisibleTo = async (client: SupabaseClient) => {
    const { data } = await client.from(TABLE).select('id');
    return (data ?? []).map((r) => r.id as string);
  };

  // ---------------------------------------------------------------------------

  describe('SELECT', () => {
    it('o autor lê o anexo do próprio chamado', async () => {
      expect(await attachmentIdsVisibleTo(member1A)).toContain(publicAttachmentId);
    });

    it('o admin da org lê o anexo de um chamado da org', async () => {
      expect(await attachmentIdsVisibleTo(adminA)).toContain(publicAttachmentId);
    });

    it('outro membro da mesma org NÃO lê anexo de chamado alheio', async () => {
      expect(await attachmentIdsVisibleTo(member2A)).not.toContain(publicAttachmentId);
    });

    it('o admin de outra org não lê nada da org A', async () => {
      const ids = await attachmentIdsVisibleTo(adminB);
      expect(ids).not.toContain(publicAttachmentId);
      expect(ids).not.toContain(internalAttachmentId);
    });

    it('um membro de outra org não lê nada da org A', async () => {
      const ids = await attachmentIdsVisibleTo(memberB);
      expect(ids).not.toContain(publicAttachmentId);
      expect(ids).not.toContain(internalAttachmentId);
    });

    it('o master lê o anexo de qualquer org, sem ser membro dela', async () => {
      expect(await attachmentIdsVisibleTo(master)).toContain(publicAttachmentId);
    });

    it('o autor NUNCA lê o anexo interno', async () => {
      expect(await attachmentIdsVisibleTo(member1A)).not.toContain(internalAttachmentId);
    });

    it('o admin da org lê o público e NUNCA o interno', async () => {
      const ids = await attachmentIdsVisibleTo(adminA);
      expect(ids).toContain(publicAttachmentId);
      expect(ids).not.toContain(internalAttachmentId);
    });

    it('o master lê os dois', async () => {
      const ids = await attachmentIdsVisibleTo(master);
      expect(ids).toContain(publicAttachmentId);
      expect(ids).toContain(internalAttachmentId);
    });

    it('o autor não alcança o anexo interno nem pedindo pelo id', async () => {
      const { data } = await member1A
        .from(TABLE)
        .select('id, path, filename')
        .eq('id', internalAttachmentId);
      expect(data ?? []).toHaveLength(0);
    });

    // O caminho é o que a policy do Storage consulta. Se ele vazasse pela
    // tabela, o `internal/` deixaria de ser uma barreira e viraria uma dica.
    it('o caminho do anexo interno não vaza pela tabela', async () => {
      const { data } = await member1A.from(TABLE).select('path').eq('ticket_id', ticketId);
      const paths = (data ?? []).map((r) => r.path as string);
      expect(paths.some((p) => p.includes('/internal/'))).toBe(false);
    });
  });

  describe('INSERT', () => {
    it('o autor anexa no próprio chamado', async () => {
      const { data, error } = await member1A
        .from(TABLE)
        .insert(
          anexo({
            ticket_id: ticketId,
            comment_id: publicCommentId,
            author_user_id: member1UserId,
            path: pathFor(ticketId),
          }),
        )
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      await master.from(TABLE).delete().eq('id', data!.id);
    });

    // `comment_id IS NULL` = veio na abertura, quando ainda não havia Comentário.
    it('o autor anexa na abertura, sem comentário', async () => {
      const { data, error } = await member1A
        .from(TABLE)
        .insert(
          anexo({
            ticket_id: ticketId,
            comment_id: null,
            author_user_id: member1UserId,
            path: pathFor(ticketId),
          }),
        )
        .select('id')
        .single();

      expect(error).toBeNull();
      await master.from(TABLE).delete().eq('id', data!.id);
    });

    it('um usuário não anexa se passando por outro', async () => {
      const { error } = await member1A.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: publicCommentId,
          author_user_id: member2UserId, // não é quem está autenticado
          path: pathFor(ticketId),
        }),
      );
      expect(error).not.toBeNull();
    });

    it('um membro de outra org não anexa num chamado da org A', async () => {
      const uid = (await memberB.auth.getUser()).data.user!.id;
      const { error } = await memberB.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: publicCommentId,
          author_user_id: uid,
          path: pathFor(ticketId),
        }),
      );
      expect(error).not.toBeNull();
    });

    it('outro membro da mesma org não anexa em chamado que não é dele', async () => {
      const { error } = await member2A.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: publicCommentId,
          author_user_id: member2UserId,
          path: pathFor(ticketId),
        }),
      );
      expect(error).not.toBeNull();
    });

    // O cenário é montado para isolar a CLÁUSULA de master da policy: o
    // comentário interno existe, o caminho tem `internal/`, a linha é coerente
    // com os dois. Tudo passa nos triggers — o que recusa é
    // `(is_internal = false OR is_master_user())`.
    it('um não-master não cria anexo interno, mesmo com tudo coerente', async () => {
      const { error } = await member1A.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: internalCommentId,
          author_user_id: member1UserId,
          is_internal: true,
          path: pathFor(ticketId, { internal: true }),
        }),
      );
      expect(error).not.toBeNull();
    });
  });

  describe('DELETE', () => {
    let alvoId: string;

    beforeAll(async () => {
      const { data, error } = await member1A
        .from(TABLE)
        .insert(
          anexo({
            ticket_id: ticketId,
            comment_id: publicCommentId,
            author_user_id: member1UserId,
            path: pathFor(ticketId),
          }),
        )
        .select('id')
        .single();
      if (error) throw new Error(`fixture anexo para delete: ${error.message}`);
      alvoId = data!.id;
    });

    // Sem policy de DELETE para o cliente, a recusa é silenciosa: zero linhas,
    // 200. É por isso que a asserção conta linhas, e não olha `error`.
    it('o autor não apaga o próprio anexo — evidência não se descarta', async () => {
      await expectDeleteDenied(member1A, TABLE, alvoId);
      const { data } = await master.from(TABLE).select('id').eq('id', alvoId);
      expect(data ?? []).toHaveLength(1);
    });

    it('o admin da org não apaga anexo', async () => {
      await expectDeleteDenied(adminA, TABLE, alvoId);
      const { data } = await master.from(TABLE).select('id').eq('id', alvoId);
      expect(data ?? []).toHaveLength(1);
    });

    it('o master apaga', async () => {
      const { error, count } = await master
        .from(TABLE)
        .delete({ count: 'exact' })
        .eq('id', alvoId);
      expect(error).toBeNull();
      expect(count).toBe(1);
    });
  });

  // Um anexo não se edita — não há policy de UPDATE. Trocar o conteúdo apagaria
  // a evidência que ele é.
  describe('UPDATE', () => {
    it('ninguém atualiza um anexo, nem o master', async () => {
      const { error, count } = await master
        .from(TABLE)
        .update({ filename: 'reescrito.png' }, { count: 'exact' })
        .eq('id', publicAttachmentId);
      expect(error).toBeNull(); // sem policy, a recusa é silenciosa
      expect(count ?? 0).toBe(0);

      const { data } = await master
        .from(TABLE)
        .select('filename')
        .eq('id', publicAttachmentId)
        .single();
      expect(data!.filename).toBe('print-do-kanban.png');
    });
  });

  // ---------------------------------------------------------------------------
  // Coerência: linha × Comentário × caminho.
  //
  // Todas as asserções abaixo rodam COMO MASTER de propósito. Como não-master,
  // a policy barraria antes e o teste passaria sem nunca exercitar o trigger —
  // verde por acidente. Como master, a policy libera e quem recusa é a guarda.
  // ---------------------------------------------------------------------------
  describe('trigger de coerência', () => {
    it('recusa anexo cujo caminho não começa pelo chamado', async () => {
      const outroTicket = crypto.randomUUID();
      const { error } = await master.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: publicCommentId,
          author_user_id: masterUserId,
          path: `${outroTicket}/${crypto.randomUUID()}.png`,
        }),
      );
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/caminho|chamado/i);
    });

    it('recusa anexo cuja visibilidade não bate com a do comentário', async () => {
      const { error } = await master.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: internalCommentId, // comentário interno...
          author_user_id: masterUserId,
          is_internal: false, // ...com anexo público
          path: pathFor(ticketId),
        }),
      );
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/visibilidade|comentario/i);
    });

    it('recusa anexo interno cujo caminho não tem o segmento internal/', async () => {
      const { error } = await master.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: internalCommentId,
          author_user_id: masterUserId,
          is_internal: true,
          path: pathFor(ticketId), // sem `internal/`
        }),
      );
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/caminho|visibilidade/i);
    });

    it('recusa anexo público cujo caminho está no ramo internal/', async () => {
      const { error } = await master.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: publicCommentId,
          author_user_id: masterUserId,
          is_internal: false,
          path: pathFor(ticketId, { internal: true }),
        }),
      );
      expect(error).not.toBeNull();
    });

    it('recusa anexo interno sem comentário — a abertura é sempre do cliente', async () => {
      const { error } = await master.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: null,
          author_user_id: masterUserId,
          is_internal: true,
          path: pathFor(ticketId, { internal: true }),
        }),
      );
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/comentario|interno/i);
    });

    it('recusa anexo cujo comentário pertence a outro chamado', async () => {
      const { data: outro, error: outroErr } = await member1A
        .from('support_tickets')
        .insert({
          organization_id: ORG_A,
          author_user_id: member1UserId,
          title: 'Segundo chamado, so para o cruzamento',
          tipo: 'duvida',
          impacto: 'incomodo',
        })
        .select('id')
        .single();
      if (outroErr) throw new Error(`fixture segundo ticket: ${outroErr.message}`);

      const { error } = await master.from(TABLE).insert(
        anexo({
          ticket_id: outro!.id,
          comment_id: publicCommentId, // comentário do PRIMEIRO chamado
          author_user_id: masterUserId,
          path: pathFor(outro!.id),
        }),
      );
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/chamado|comentario/i);

      await master.from('support_tickets').delete().eq('id', outro!.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Tetos de volume. O trigger é DEFINER: o `count(*)` de um cliente, como
  // invoker, não enxergaria as linhas internas e o teto seria furável por quem
  // vê menos. Aqui os anexos são todos públicos — o que se prova é o número.
  // ---------------------------------------------------------------------------
  describe('tetos de volume', () => {
    it('recusa o 6º anexo na mesma mensagem', async () => {
      const { data: c, error: cErr } = await member1A
        .from('support_ticket_comments')
        .insert({ ticket_id: ticketId, author_user_id: member1UserId, body: 'Cinco prints.' })
        .select('id')
        .single();
      if (cErr) throw new Error(`fixture comentario do teto: ${cErr.message}`);

      const criados: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { data, error } = await member1A
          .from(TABLE)
          .insert(
            anexo({
              ticket_id: ticketId,
              comment_id: c!.id,
              author_user_id: member1UserId,
              path: pathFor(ticketId),
            }),
          )
          .select('id')
          .single();
        expect(error).toBeNull();
        criados.push(data!.id);
      }

      const { error: sexto } = await member1A.from(TABLE).insert(
        anexo({
          ticket_id: ticketId,
          comment_id: c!.id,
          author_user_id: member1UserId,
          path: pathFor(ticketId),
        }),
      );
      expect(sexto).not.toBeNull();
      expect(sexto?.message ?? '').toMatch(/5 anexos|mensagem/i);

      for (const id of criados) await master.from(TABLE).delete().eq('id', id);
      await master.from('support_ticket_comments').delete().eq('id', c!.id);
    });

    // Chamado próprio: 20 anexos em 4 comentários de 5 (o teto por mensagem
    // impediria de chegar a 20 num comentário só). Não usa o chamado principal
    // para não acoplar a contagem à ordem dos outros testes.
    it('recusa o 21º anexo no mesmo chamado', async () => {
      const { data: t, error: tErr } = await member1A
        .from('support_tickets')
        .insert({
          organization_id: ORG_A,
          author_user_id: member1UserId,
          title: 'Chamado do teto de vinte anexos',
          tipo: 'duvida',
          impacto: 'incomodo',
        })
        .select('id')
        .single();
      if (tErr) throw new Error(`fixture ticket do teto: ${tErr.message}`);
      const tid = t!.id;

      try {
        for (let grupo = 0; grupo < 4; grupo++) {
          const { data: c, error: cErr } = await member1A
            .from('support_ticket_comments')
            .insert({ ticket_id: tid, author_user_id: member1UserId, body: `Lote ${grupo}` })
            .select('id')
            .single();
          if (cErr) throw new Error(`fixture comentario ${grupo}: ${cErr.message}`);

          for (let i = 0; i < 5; i++) {
            const { error } = await member1A.from(TABLE).insert(
              anexo({
                ticket_id: tid,
                comment_id: c!.id,
                author_user_id: member1UserId,
                path: pathFor(tid),
              }),
            );
            expect(error).toBeNull();
          }
        }

        // O 21º vai num comentário NOVO — o teto por mensagem está zerado ali,
        // então quem recusa só pode ser o teto do chamado.
        const { data: cUltimo } = await member1A
          .from('support_ticket_comments')
          .insert({ ticket_id: tid, author_user_id: member1UserId, body: 'Mais um' })
          .select('id')
          .single();

        const { error: vinteUm } = await member1A.from(TABLE).insert(
          anexo({
            ticket_id: tid,
            comment_id: cUltimo!.id,
            author_user_id: member1UserId,
            path: pathFor(tid),
          }),
        );
        expect(vinteUm).not.toBeNull();
        expect(vinteUm?.message ?? '').toMatch(/20 anexos|chamado/i);
      } finally {
        await master.from('support_tickets').delete().eq('id', tid);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // `is_internal` do Comentário é imutável — pré-requisito da coerência acima.
  // Se ele virasse depois do upload, o caminho (que a policy do Storage lê) e a
  // linha discordariam em silêncio, e a discordância favorece o vazamento.
  // ---------------------------------------------------------------------------
  describe('is_internal do comentário é imutável', () => {
    it('o master não torna interno um comentário público', async () => {
      const { error } = await master
        .from('support_ticket_comments')
        .update({ is_internal: true, from_staff: true })
        .eq('id', publicCommentId);
      expect(error).not.toBeNull();
      expect(error?.message ?? '').toMatch(/visibilidade|nao muda/i);
    });

    it('o master não torna público um comentário interno', async () => {
      const { error } = await master
        .from('support_ticket_comments')
        .update({ is_internal: false })
        .eq('id', internalCommentId);
      expect(error).not.toBeNull();
    });

    // A guarda trava a visibilidade, não o comentário inteiro.
    it('o master ainda corrige o corpo de um comentário', async () => {
      const { error } = await master
        .from('support_ticket_comments')
        .update({ body: 'Corrigido: era o stage_cap mesmo.' })
        .eq('id', internalCommentId);
      expect(error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Fora do alcance desta suíte.
  // ---------------------------------------------------------------------------
  describe('autorização do objeto no Storage', () => {
    // `can_read_support_attachment()` decide pelo CAMINHO, sobre
    // `storage.objects` — não sobre esta tabela. Exercitá-la de verdade exige
    // subir um arquivo pela API de Storage e tentar assiná-lo como cada perfil,
    // e o bucket `support-attachments` não é semeado por `tests/integration/setup.ts`.
    // Um teste que só inserisse a LINHA e afirmasse "o cliente não lê o interno"
    // estaria repetindo a asserção de SELECT acima e provando zero sobre o
    // Storage — que é justamente onde o arquivo mora.
    it.skip('o cliente não assina URL de um objeto no ramo internal/', () => {});
    it.skip('o master assina URL de um objeto no ramo internal/', () => {});
  });

  describe('retenção de 90 dias', () => {
    // `purge_expired_support_attachments()` teve EXECUTE revogado de
    // `authenticated` — nenhum dos clientes desta suíte pode chamá-la, e ela
    // depende de `app.service_role_key`/`app.settings.supabase_url` (ausentes no
    // stack local, onde a função sai pelo RAISE WARNING sem apagar nada) e de
    // um `closed_at` com mais de 90 dias, que só o service_role forjaria.
    // Cobrir isso é uma suíte à parte, com service_role, não RLS.
    it.skip('apaga anexo de chamado fechado há mais de 90 dias', () => {});
  });
});
