// Perf — 20271127000000 reescreve o corpo das duas varreduras de avisos
// (follow-ups e reunião próxima). Contrato: os avisos emitidos são os MESMOS.
//
// Prova: dois bancos com a mesma base sorteada; um roda o corpo antigo
// (20271126000000, conferido por md5 contra prod em 19/10), o outro o novo.
// Mesmo relógio, mesmas mutações entre rodadas, mesma sessão; compara a tabela
// notifications inteira e o retorno de cada chamada. O relógio das funções é
// trocado por public.relogio() nas DUAS versões, pela mesma substituição de
// texto, para exercitar os dois ramos do horário (antes/depois das 07h BRT) e
// a virada do dia.
//
// Controle positivo (verde por ausência): casos montados à mão com
// destinatário esperado explícito, e contagem mínima de cada tipo de aviso na
// base sorteada — comparar dois conjuntos vazios não provaria nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const antiga = sql('20271126000000_avisos_a_todos_os_donos_e_owner_includes.sql');
const nova = sql('20271127000000_varreduras_de_avisos_set_based.sql');
const rollback = sql('rollback/20271127000000_varreduras_de_avisos_set_based.sql');

// Corpo vigente em prod (19/10): md5(prosrc).
const MD5_PROD = {
  fn_varredura_avisos_followups: '77dd6bcc12023981fa010d02549de891',
  fn_varredura_avisos_reuniao_proxima: '9bb3b79b0a8fd34c372875fa83af2b32',
};

const trecho = (texto, de, ate) => {
  const i = texto.indexOf(de);
  const j = texto.indexOf(ate, i);
  assert.ok(i >= 0 && j > i, `trecho não encontrado: ${de}`);
  return texto.slice(i, j);
};
const VARREDURAS_ANTIGAS = trecho(antiga,
  '-- ─── 4. fn_varredura_avisos_followups', '-- ─── 6. chat_scope_for_recipient');
const comRelogio = texto => texto.replaceAll('now()', 'public.relogio()');

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ORG_A = id(9001); // sem a flag
const ORG_B = id(9002); // com lead_owners_n_donos
const ORG_C = id(9003); // sem a flag

// Definições de prod (pg_get_functiondef, 19/10), sem mudança.
const DEPENDENCIAS = `
CREATE OR REPLACE FUNCTION public.fn_dono_do_lead(p_lead_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.sale_responsible_id     AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.closer_id               AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.pre_sale_responsible_id AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.sdr_id                  AND tm.is_active AND tm.user_id IS NOT NULL),
    (SELECT tm.user_id FROM public.team_members tm JOIN public.leads l ON l.id = p_lead_id
      WHERE tm.id = l.responsible_id          AND tm.is_active AND tm.user_id IS NOT NULL)
  );
$function$;
CREATE OR REPLACE FUNCTION public.lead_owners_enabled(p_org uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT COALESCE(
    (SELECT o.feature_flags ->> 'lead_owners_n_donos' = 'true'
       FROM public.organizations o
      WHERE o.id = p_org),
    false)
$function$;
CREATE OR REPLACE FUNCTION public.fn_donos_do_lead(p_lead_id uuid)
 RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_org       uuid;
  v_principal uuid;
BEGIN
  v_principal := public.fn_dono_do_lead(p_lead_id);
  SELECT l.organization_id INTO v_org FROM public.leads l WHERE l.id = p_lead_id;
  IF v_org IS NULL OR NOT public.lead_owners_enabled(v_org) THEN
    RETURN CASE WHEN v_principal IS NULL THEN '{}'::uuid[] ELSE ARRAY[v_principal] END;
  END IF;
  RETURN COALESCE((
    SELECT array_agg(c.user_id ORDER BY c.ord, c.ts, c.user_id)
    FROM (
      SELECT u.user_id, min(u.ord) AS ord, min(u.ts) AS ts
      FROM (
        SELECT v_principal AS user_id, 0 AS ord, 'epoch'::timestamptz AS ts
        UNION ALL
        SELECT tm.user_id, 1, 'epoch'::timestamptz
          FROM public.leads l
          JOIN public.team_members tm ON tm.id = l.sale_responsible_id
         WHERE l.id = p_lead_id AND tm.organization_id = l.organization_id
           AND tm.is_active AND tm.user_id IS NOT NULL
        UNION ALL
        SELECT tm.user_id, 2, 'epoch'::timestamptz
          FROM public.leads l
          JOIN public.team_members tm ON tm.id = l.pre_sale_responsible_id
         WHERE l.id = p_lead_id AND tm.organization_id = l.organization_id
           AND tm.is_active AND tm.user_id IS NOT NULL
        UNION ALL
        SELECT tm.user_id,
               CASE o.role WHEN 'venda' THEN 3 WHEN 'pre_venda' THEN 4 ELSE 5 END,
               o.added_at
          FROM public.lead_owners o
          JOIN public.team_members tm ON tm.id = o.team_member_id
         WHERE o.lead_id = p_lead_id AND o.organization_id = v_org
           AND tm.organization_id = v_org
           AND tm.is_active AND tm.user_id IS NOT NULL
      ) u
      WHERE u.user_id IS NOT NULL
      GROUP BY u.user_id
    ) c
  ), '{}'::uuid[]);
END;
$function$;
CREATE OR REPLACE FUNCTION public.fn_emit_aviso(p_organization_id uuid, p_user_id uuid, p_type text, p_group_key text, p_title text, p_description text DEFAULT NULL::text, p_link text DEFAULT NULL::text, p_lead_id uuid DEFAULT NULL::uuid, p_entity_id uuid DEFAULT NULL::uuid, p_occurred_at timestamp with time zone DEFAULT now())
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_organization_id IS NULL OR p_user_id IS NULL OR p_group_key IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications AS n (
    organization_id, user_id, type, title, description, link,
    lead_id, entity_id, group_key, event_count, last_event_at
  )
  VALUES (
    p_organization_id, p_user_id, p_type, p_title, p_description, p_link,
    p_lead_id, p_entity_id, p_group_key, 1, COALESCE(p_occurred_at, now())
  )
  ON CONFLICT (user_id, group_key) WHERE read_at IS NULL AND group_key IS NOT NULL
  DO UPDATE SET
    event_count   = n.event_count + 1,
    last_event_at = GREATEST(n.last_event_at, EXCLUDED.last_event_at),
    title         = EXCLUDED.title,
    description   = COALESCE(EXCLUDED.description, n.description),
    link          = COALESCE(EXCLUDED.link, n.link),
    entity_id     = COALESCE(EXCLUDED.entity_id, n.entity_id)
  RETURNING n.id INTO v_id;
  RETURN v_id;
END;
$function$;
`;

const ESQUELETO = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA private;
CREATE FUNCTION public.relogio() RETURNS timestamptz LANGUAGE sql STABLE
  AS $$ SELECT current_setting('test.agora')::timestamptz $$;
CREATE TABLE organizations(id uuid PRIMARY KEY, feature_flags jsonb DEFAULT '{}');
CREATE TABLE team_members(id uuid PRIMARY KEY, organization_id uuid, user_id uuid, is_active boolean);
CREATE INDEX ON team_members(user_id); CREATE INDEX ON team_members(organization_id);
CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid, name text, deleted_at timestamptz,
  sale_responsible_id uuid, closer_id uuid, pre_sale_responsible_id uuid, sdr_id uuid, responsible_id uuid);
CREATE TABLE lead_owners(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, organization_id uuid,
  team_member_id uuid, role text, is_primary boolean DEFAULT false, added_at timestamptz DEFAULT now(),
  UNIQUE (lead_id, team_member_id, role));
CREATE TABLE follow_ups(id uuid PRIMARY KEY, organization_id uuid, lead_id uuid, assigned_to uuid,
  title text, due_date timestamptz, completed_at timestamptz, archived_at timestamptz);
CREATE INDEX follow_ups_pending_reminder_date_idx ON follow_ups(due_date)
  WHERE completed_at IS NULL AND archived_at IS NULL;
CREATE TABLE pipeline_entries(id uuid PRIMARY KEY, organization_id uuid, lead_id uuid, assigned_to uuid,
  closed_at timestamptz, metadata jsonb, deal_id uuid);
CREATE INDEX pipeline_entries_pending_meeting_reminder_idx ON pipeline_entries(id)
  WHERE closed_at IS NULL AND NULLIF(metadata ->> 'meeting_date', '') IS NOT NULL;
CREATE TABLE meetings(id uuid PRIMARY KEY, organization_id uuid, lead_id uuid, title text, start_at timestamptz,
  created_by uuid, status text DEFAULT 'scheduled', event_type text DEFAULT 'meeting',
  all_day boolean DEFAULT false, pipeline_entry_id uuid, deal_id uuid);
CREATE TABLE meeting_participants(meeting_id uuid, team_member_id uuid, status text DEFAULT 'pending');
CREATE TABLE meeting_events(id uuid PRIMARY KEY, organization_id uuid, source_entry_id uuid,
  booked_event_id uuid, event_type text, meeting_date timestamptz);
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid,
  type text, title text, description text, link text, lead_id uuid, entity_id uuid, group_key text,
  event_count integer DEFAULT 1, last_event_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
  read_at timestamptz);
CREATE UNIQUE INDEX notifications_unread_group_key_uniq ON notifications(user_id, group_key)
  WHERE read_at IS NULL AND group_key IS NOT NULL;
CREATE INDEX notifications_reminder_lookup_idx ON notifications(organization_id, user_id, group_key)
  WHERE group_key IS NOT NULL;
`;

// PRNG determinístico (mulberry32): a base sorteada é a mesma em toda execução.
const prng = semente => () => {
  semente = (semente + 0x6D2B79F5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const q = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);
const minutos = (t, m) => new Date(t.getTime() + m * 60000);

// Relógios (UTC): 10h BRT, 05h BRT, +1 min, dia seguinte 10h BRT.
const T_MANHA = new Date('2026-10-19T13:00:00Z');
const T_MADRUGADA = new Date('2026-10-19T08:00:00Z');
const T_DIA_SEGUINTE = new Date('2026-10-20T13:00:00Z');

function base(rand, t0) {
  const orgs = [ORG_A, ORG_B, ORG_C];
  const linhas = [];
  linhas.push(`INSERT INTO organizations VALUES (${q(ORG_A)},'{}'),
    (${q(ORG_B)},'{"lead_owners_n_donos":"true"}'), (${q(ORG_C)},'{"lead_owners_n_donos":"false"}');`);
  // Membros: ativos, inativos, sem usuário; o usuário 1000+k pode estar em
  // várias orgs e em dois papéis (duas linhas) da mesma org.
  const membros = [];
  let n = 100;
  for (const org of orgs) {
    for (let k = 0; k < 9; k++) {
      const ativo = rand() > 0.15;
      const user = rand() > 0.08 ? id(1000 + Math.floor(rand() * 14)) : null;
      membros.push({ id: id(n), org, user, ativo });
      n++;
    }
  }
  // Mesmo usuário com duas linhas ativas na mesma org.
  membros.push({ id: id(n++), org: ORG_B, user: membros.find(m => m.org === ORG_B && m.user && m.ativo).user, ativo: true });
  linhas.push(`INSERT INTO team_members VALUES ${membros.map(m => `(${q(m.id)},${q(m.org)},${q(m.user)},${m.ativo})`).join(',')};`);
  const doOrg = org => membros.filter(m => m.org === org);
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const talvez = (p, f) => (rand() < p ? f() : null);

  const leads = [];
  for (let k = 0; k < 160; k++) {
    const org = pick(orgs);
    const daOrg = doOrg(org);
    // Às vezes um papel aponta para membro de OUTRA org (fn_dono_do_lead não
    // checa org; fn_donos_do_lead checa para venda/pré-venda).
    const qualquer = () => (rand() < 0.1 ? pick(membros) : pick(daOrg)).id;
    leads.push({
      id: id(20000 + k), org, nome: rand() < 0.1 ? null : `Lead ${k}`,
      deleted: rand() < 0.08,
      sale: talvez(0.45, qualquer), closer: talvez(0.3, qualquer), pre: talvez(0.35, qualquer),
      sdr: talvez(0.25, qualquer), resp: talvez(0.3, qualquer),
    });
  }
  linhas.push(`INSERT INTO leads VALUES ${leads.map(l => `(${q(l.id)},${q(l.org)},${q(l.nome)},${l.deleted ? q(t0.toISOString()) : 'NULL'},
    ${q(l.sale)},${q(l.closer)},${q(l.pre)},${q(l.sdr)},${q(l.resp)})`).join(',')};`);

  const donos = [];
  for (const l of leads) {
    if (rand() < 0.5) continue;
    for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) {
      const m = rand() < 0.1 ? pick(membros) : pick(doOrg(l.org));
      const role = pick(['co', 'venda', 'pre_venda']);
      const org = rand() < 0.05 ? pick(orgs) : l.org;
      donos.push(`(${q(l.id)},${q(org)},${q(m.id)},${q(role)},${q(minutos(t0, -k * 7).toISOString())})`);
    }
  }
  linhas.push(`INSERT INTO lead_owners(lead_id,organization_id,team_member_id,role,added_at) VALUES ${donos.join(',')}
    ON CONFLICT DO NOTHING;`);

  const fups = [];
  for (let k = 0; k < 420; k++) {
    const l = pick(leads);
    const org = rand() < 0.04 ? pick(orgs) : l.org; // lead de outra org: não avisa
    const atribuido = rand() < 0.5 ? (rand() < 0.15 ? pick(membros).id : pick(doOrg(org)).id) : null;
    // de 3 dias atrás a +30 min, com massa perto das bordas (−1 h, +15 min)
    const faixa = rand();
    const delta = faixa < 0.3 ? -60 + (rand() * 6 - 3)
      : faixa < 0.5 ? 15 + (rand() * 4 - 2)
        : -4320 + rand() * 4350;
    fups.push(`(${q(id(40000 + k))},${q(org)},${q(l.id)},${q(atribuido)},${q(rand() < 0.15 ? '' : `Tarefa ${k}`)},
      ${q(minutos(t0, Math.round(delta)).toISOString())},
      ${rand() < 0.08 ? q(t0.toISOString()) : 'NULL'},${rand() < 0.05 ? q(t0.toISOString()) : 'NULL'})`);
  }
  linhas.push(`INSERT INTO follow_ups VALUES ${fups.join(',')};`);

  // Funil: muitas datas antigas/futuras, algumas na janela, em vários formatos.
  const formatos = [
    d => d.toISOString(),                                         // ...Z
    d => d.toISOString().replace('.000Z', '+00:00'),              // prod
    d => d.toISOString().slice(0, 16).replace('T', ' '),          // sem fuso
    d => d.toISOString().slice(0, 19),                            // sem fuso, T
    d => d.toISOString().slice(0, 10),                            // só data
    d => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 16).replace('T', ' '), // sem fuso, hora de Brasília
    d => new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 19),                   // idem, T
    d => new Date(d.getTime() + 3 * 3600000).toISOString().slice(0, 19) + '-03:00',
    d => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`, // MDY
    () => '2026-13-45 10:00',                                     // inválida
    () => 'amanhã às 10h',                                        // lixo
    () => '',                                                     // vazia
  ];
  const entradas = [];
  const espelhos = [];
  const eventos = [];
  for (let k = 0; k < 700; k++) {
    const l = pick(leads);
    const org = rand() < 0.04 ? pick(orgs) : l.org;
    const perto = rand() < 0.35;
    const delta = perto ? Math.round(rand() * 30 - 10) : Math.round(rand() * 200000 - 100000);
    const d = minutos(t0, delta);
    const texto = pick(formatos)(d);
    const meta = rand() < 0.08 ? {} : { meeting_date: texto };
    const entryId = id(60000 + k);
    const deal = rand() < 0.3 ? id(70000 + k) : null;
    if (rand() < 0.1) meta.agenda_espelho = { meeting_id: id(80000 + k) };
    const atribuido = rand() < 0.4 ? (rand() < 0.15 ? pick(membros).id : pick(doOrg(org)).id) : null;
    entradas.push(`(${q(entryId)},${q(org)},${q(l.id)},${q(atribuido)},${rand() < 0.1 ? q(t0.toISOString()) : 'NULL'},
      ${q(JSON.stringify(meta))},${q(deal)})`);
    // espelho canônico em meetings (por id, por entry/deal + instante, por lead + instante)
    const r = rand();
    if (perto && r < 0.12) espelhos.push(`(${q(id(80000 + k))},${q(org)},${q(l.id)},'Espelho',${q(d.toISOString())},NULL,'cancelled','meeting',false,NULL,NULL)`);
    else if (perto && r < 0.2) espelhos.push(`(${q(id(85000 + k))},${q(org)},NULL,'Por entry',${q(d.toISOString())},NULL,'completed','meeting',false,${q(entryId)},NULL)`);
    else if (perto && r < 0.26) espelhos.push(`(${q(id(85000 + k))},${q(org)},${q(l.id)},'Por lead',${q(d.toISOString())},NULL,'scheduled','meeting',true,NULL,NULL)`);
    if (perto && rand() < 0.12) {
      eventos.push(`(${q(id(90000 + k))},${q(org)},${q(entryId)},NULL,'meeting_booked',${q(d.toISOString())})`);
      eventos.push(`(${q(id(95000 + k))},${q(org)},NULL,${q(id(90000 + k))},${q(pick(['meeting_held', 'meeting_no_show', 'meeting_rescheduled']))},${q(d.toISOString())})`);
    }
  }
  // volume de entradas abertas SEM data (prod: 59 mil): não pode entrar no laço.
  for (let k = 0; k < 3000; k++) {
    entradas.push(`(${q(id(200000 + k))},${q(pick(orgs))},${q(pick(leads).id)},NULL,NULL,'{"outra":"coisa"}',NULL)`);
  }
  linhas.push(`INSERT INTO pipeline_entries VALUES ${entradas.join(',')};`);

  // Agenda interna (1º laço, que não muda): alguns na janela.
  const reunioes = [];
  const participantes = [];
  for (let k = 0; k < 60; k++) {
    const org = pick(orgs);
    const l = rand() < 0.6 ? pick(leads.filter(x => x.org === org)) : null;
    const mid = id(100000 + k);
    reunioes.push(`(${q(mid)},${q(org)},${q(l?.id)},${q(rand() < 0.2 ? '' : `Compromisso ${k}`)},
      ${q(minutos(t0, Math.round(rand() * 30 - 10)).toISOString())},${q(pick(doOrg(org)).user)},
      ${q(rand() < 0.85 ? 'scheduled' : 'cancelled')},${q(pick(['meeting', 'call', 'follow_up', 'task', 'other', 'block']))},
      ${rand() < 0.1},NULL,NULL)`);
    for (const m of doOrg(org)) if (rand() < 0.25) participantes.push(`(${q(mid)},${q(m.id)},${q(pick(['pending', 'accepted', 'declined']))})`);
  }
  linhas.push(`INSERT INTO meetings VALUES ${[...reunioes, ...espelhos].join(',')};`);
  if (participantes.length) linhas.push(`INSERT INTO meeting_participants VALUES ${participantes.join(',')};`);
  if (eventos.length) linhas.push(`INSERT INTO meeting_events VALUES ${eventos.join(',')};`);
  linhas.push('ANALYZE;');
  return { sql: linhas.join('\n'), membros, leads };
}

// Mutações entre rodadas, iguais nos dois bancos (sorteio próprio, mesma semente).
function mutacao(rand, membros) {
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const comandos = [];
  for (let k = 0; k < 25; k++) {
    const f = id(40000 + Math.floor(rand() * 420));
    const r = rand();
    if (r < 0.3) comandos.push(`UPDATE follow_ups SET assigned_to = ${rand() < 0.3 ? 'NULL' : q(pick(membros).id)} WHERE id = ${q(f)};`);
    else if (r < 0.45) comandos.push(`UPDATE follow_ups SET due_date = due_date - interval '${1 + Math.floor(rand() * 90)} minutes' WHERE id = ${q(f)};`);
    else if (r < 0.55) comandos.push(`UPDATE team_members SET is_active = NOT is_active WHERE id = ${q(pick(membros).id)};`);
    else if (r < 0.7) comandos.push(`INSERT INTO lead_owners(lead_id,organization_id,team_member_id,role)
      SELECT lead_id, organization_id, ${q(pick(membros).id)}, 'co' FROM follow_ups WHERE id = ${q(f)} ON CONFLICT DO NOTHING;`);
    else if (r < 0.8) comandos.push(`UPDATE leads SET sale_responsible_id = ${q(pick(membros).id)}
      WHERE id = (SELECT lead_id FROM follow_ups WHERE id = ${q(f)});`);
    else comandos.push(`UPDATE pipeline_entries SET assigned_to = ${q(pick(membros).id)} WHERE id = ${q(id(60000 + Math.floor(rand() * 700)))};`);
  }
  // ler e apagar avisos (ler não rearma; apagar rearma na próxima rodada).
  comandos.push(`UPDATE notifications SET read_at = public.relogio() WHERE ('x' || substr(md5(group_key || user_id::text), 1, 2))::bit(8)::int < 90;`);
  comandos.push(`DELETE FROM notifications WHERE ('x' || substr(md5(user_id::text || group_key), 1, 2))::bit(8)::int < 25;`);
  comandos.push(`UPDATE organizations SET feature_flags = '{"lead_owners_n_donos":"true"}' WHERE id = ${q(ORG_C)};`);
  return comandos.join('\n');
}

async function banco(versao, dadosSql) {
  const db = new PGlite();
  await db.exec(ESQUELETO);
  await db.exec(DEPENDENCIAS);
  await db.exec(dadosSql);
  // Corpo antigo, cru, para conferir o md5 de prod.
  await db.exec(VARREDURAS_ANTIGAS);
  const md5 = (await db.query(`SELECT proname, md5(prosrc) AS m FROM pg_proc
    WHERE proname IN ('fn_varredura_avisos_followups','fn_varredura_avisos_reuniao_proxima')`)).rows;
  for (const { proname, m } of md5) assert.equal(m, MD5_PROD[proname], `${proname}: corpo "antes" ≠ prod`);
  await db.exec(comRelogio(versao === 'antiga' ? VARREDURAS_ANTIGAS : nova));
  return db;
}

const ESTADO = `SELECT organization_id, user_id, type, group_key, title, description, link, lead_id, entity_id,
  event_count, read_at IS NOT NULL AS lida FROM notifications ORDER BY group_key, user_id, lida, event_count`;

async function rodada(dbs, agora, fuso) {
  const retornos = [];
  for (const db of dbs) {
    await db.exec(`SET test.agora = '${agora.toISOString()}'; SET TimeZone = '${fuso}';`);
    const f = (await db.query('SELECT fn_varredura_avisos_followups() AS n')).rows[0].n;
    const r = (await db.query('SELECT fn_varredura_avisos_reuniao_proxima() AS n')).rows[0].n;
    retornos.push({ f, r });
  }
  return retornos;
}

test('varreduras set-based emitem exatamente os mesmos avisos que o corpo de prod', async () => {
  for (const fuso of ['UTC', 'America/Sao_Paulo']) {
    for (const t0 of [T_MANHA, T_MADRUGADA]) {
      const dados = base(prng(42), t0);
      const antiga = await banco('antiga', dados.sql);
      const nova = await banco('nova', dados.sql);
      try {
        const relogios = [t0, minutos(t0, 1), minutos(t0, 7), T_DIA_SEGUINTE, minutos(T_DIA_SEGUINTE, 3)];
        let emitidos = 0;
        for (const [k, agora] of relogios.entries()) {
          const [ra, rn] = await rodada([antiga, nova], agora, fuso);
          assert.deepEqual(rn, ra, `${fuso} ${t0.toISOString()} rodada ${k}: retorno`);
          const [ea, en] = [(await antiga.query(ESTADO)).rows, (await nova.query(ESTADO)).rows];
          assert.deepEqual(en, ea, `${fuso} ${t0.toISOString()} rodada ${k}: avisos`);
          emitidos += ra.f + ra.r;
          if (k < relogios.length - 1) {
            const m = mutacao(prng(1000 + k), dados.membros);
            await antiga.exec(m);
            await nova.exec(m);
          }
        }
        // Controle positivo: a base exercita todos os tipos e ramos.
        const tipos = Object.fromEntries((await antiga.query(`SELECT type || ':' || split_part(group_key, ':', 1) AS k,
          count(*)::int AS n FROM notifications GROUP BY 1`)).rows.map(r => [r.k, r.n]));
        assert.ok(emitidos > 50, `poucos avisos para provar equivalência: ${emitidos}`);
        if (t0 === T_MANHA) assert.ok(tipos['follow_up_overdue:fup'] > 10, JSON.stringify(tipos));
        assert.ok(tipos['follow_up_due:fup'] > 5, JSON.stringify(tipos));
        assert.ok(tipos['meeting_soon:meet_soon'] > 5, JSON.stringify(tipos));
        assert.ok(tipos['meeting_soon:agenda'] > 0, JSON.stringify(tipos));
        if (fuso !== 'UTC') {
          const semFuso = (await antiga.query(`SELECT count(*)::int AS n FROM notifications n
            JOIN pipeline_entries pe ON pe.id = n.entity_id
            WHERE n.group_key LIKE 'meet_soon:%' AND (pe.metadata ->> 'meeting_date') !~ '(Z|[+-][0-9]{2}:?[0-9]{2})$'
              AND length(pe.metadata ->> 'meeting_date') > 10`)).rows[0].n;
          assert.ok(semFuso > 0, 'controle: data sem fuso lida no fuso da sessão precisa avisar');
        }
      } finally {
        await antiga.close();
        await nova.close();
      }
    }
  }
});

test('casos à mão: atribuído, principal por fallback, co-dono só com a flag, dedup e outra org', async () => {
  const t0 = T_MANHA;
  const db = new PGlite();
  try {
    await db.exec(ESQUELETO);
    await db.exec(DEPENDENCIAS);
    await db.exec(comRelogio(nova));
    const u = k => id(5000 + k);
    await db.exec(`
      INSERT INTO organizations VALUES (${q(ORG_A)},'{}'), (${q(ORG_B)},'{"lead_owners_n_donos":"true"}');
      INSERT INTO team_members VALUES
        (${q(id(1))},${q(ORG_A)},${q(u(1))},true),   -- atribuído
        (${q(id(2))},${q(ORG_A)},${q(u(2))},false),  -- closer inativo
        (${q(id(3))},${q(ORG_A)},${q(u(3))},true),   -- sdr (principal por fallback)
        (${q(id(4))},${q(ORG_B)},${q(u(4))},true),   -- venda em B
        (${q(id(5))},${q(ORG_B)},${q(u(5))},true),   -- co-dono em B
        (${q(id(6))},${q(ORG_B)},${q(u(4))},true),   -- mesmo usuário, 2º papel
        (${q(id(7))},${q(ORG_A)},${q(u(7))},true),   -- co-dono em A (sem flag: não avisa)
        (${q(id(8))},${q(ORG_A)},${q(u(8))},true);   -- membro de A atribuído em follow-up de B
      INSERT INTO leads(id,organization_id,name,closer_id,sdr_id,sale_responsible_id) VALUES
        (${q(id(11))},${q(ORG_A)},'Ana',${q(id(2))},${q(id(3))},NULL),
        (${q(id(12))},${q(ORG_B)},'Bia',NULL,NULL,${q(id(4))});
      INSERT INTO lead_owners(lead_id,organization_id,team_member_id,role) VALUES
        (${q(id(12))},${q(ORG_B)},${q(id(5))},'co'), (${q(id(12))},${q(ORG_B)},${q(id(6))},'co'),
        (${q(id(11))},${q(ORG_A)},${q(id(7))},'co');
      INSERT INTO follow_ups VALUES
        (${q(id(21))},${q(ORG_A)},${q(id(11))},${q(id(1))},'Ligar',${q(minutos(t0, -600).toISOString())},NULL,NULL),
        (${q(id(22))},${q(ORG_A)},${q(id(11))},NULL,'',${q(minutos(t0, 10).toISOString())},NULL,NULL),
        (${q(id(23))},${q(ORG_B)},${q(id(12))},NULL,'Proposta',${q(minutos(t0, -30).toISOString())},NULL,NULL),
        (${q(id(24))},${q(ORG_B)},${q(id(12))},${q(id(8))},'Outra org',${q(minutos(t0, -30).toISOString())},NULL,NULL);
      SET test.agora = '${t0.toISOString()}'; SET TimeZone = 'UTC';
    `);
    assert.equal((await db.query('SELECT fn_varredura_avisos_followups() AS n')).rows[0].n, 6);
    const rows = (await db.query(`SELECT entity_id, user_id, type, title, description FROM notifications ORDER BY entity_id, user_id`)).rows;
    assert.deepEqual(rows.map(r => [r.entity_id, r.user_id]), [
      [id(21), u(1)],           // atribuído: só ele
      [id(22), u(3)],           // sem atribuído, A sem flag: principal = sdr (closer inativo); co-dono não
      [id(23), u(4)], [id(23), u(5)], // B com flag: venda + co-dono; u(4) uma vez só
      // id(24): atribuído de outra org não conta → donos de B
      [id(24), u(4)], [id(24), u(5)],
    ]);
    assert.equal(rows[0].type, 'follow_up_overdue');
    assert.equal(rows[0].title, 'Follow-up atrasado');
    assert.equal(rows[0].description, 'Ligar · Ana · 19/10 00:00');
    assert.equal(rows[1].type, 'follow_up_due');
    assert.equal(rows[1].description, 'Ana · 19/10 10:10');
    // Segunda rodada no mesmo dia: nada novo; lido não rearma.
    await db.exec(`UPDATE notifications SET read_at = now()`);
    assert.equal((await db.query('SELECT fn_varredura_avisos_followups() AS n')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('2º laço lê só as candidatas pelo índice; follow-ups não chamam fn_donos_do_lead', async () => {
  const t0 = T_MANHA;
  const dados = base(prng(7), t0);
  const antiga = await banco('antiga', dados.sql);
  const nova = await banco('nova', dados.sql);
  try {
    for (const db of [antiga, nova]) await db.exec(`SET test.agora = '${t0.toISOString()}'; SET enable_seqscan = off;`);
    const candidatas = `EXPLAIN (COSTS OFF) SELECT pe.* FROM public.pipeline_entries pe
      WHERE pe.closed_at IS NULL AND NULLIF(pe.metadata ->> 'meeting_date', '') IS NOT NULL
        AND (private.fn_aviso_meeting_date_aprox(pe.metadata ->> 'meeting_date')
              BETWEEN public.relogio() - interval '1 hour' AND public.relogio() + interval '1 hour'
          OR private.fn_aviso_meeting_date_aprox(pe.metadata ->> 'meeting_date') IS NULL)`;
    const plano = (await nova.query(candidatas)).rows.map(r => r['QUERY PLAN']).join('\n');
    assert.match(plano, /pipeline_entries_meeting_reminder_at_idx/, plano);
    assert.equal((await nova.query(`SELECT count(*)::int AS n FROM pg_indexes
      WHERE indexname = 'pipeline_entries_pending_meeting_reminder_idx'`)).rows[0].n, 0, 'índice antigo sai');
    // Superconjunto: toda linha que a conversão exata põe na janela está no pré-filtro.
    const fora = (await nova.query(`SELECT count(*)::int AS n FROM pipeline_entries pe
      WHERE pe.closed_at IS NULL AND pg_input_is_valid(pe.metadata ->> 'meeting_date', 'timestamptz')
        AND (pe.metadata ->> 'meeting_date')::timestamptz BETWEEN public.relogio() - interval '5 minutes' AND public.relogio() + interval '15 minutes'
        AND NOT coalesce(private.fn_aviso_meeting_date_aprox(pe.metadata ->> 'meeting_date')
              BETWEEN public.relogio() - interval '1 hour' AND public.relogio() + interval '1 hour', true)`)).rows[0].n;
    assert.equal(fora, 0);
    // Data ISO com fuso longe da janela (> 2 dias) não entra no laço — e existe muita.
    const longe = (await nova.query(`SELECT
        count(*) FILTER (WHERE lida)::int AS lidas, count(*)::int AS total
      FROM (SELECT (private.fn_aviso_meeting_date_aprox(pe.metadata ->> 'meeting_date')
              BETWEEN public.relogio() - interval '1 hour' AND public.relogio() + interval '1 hour'
          OR private.fn_aviso_meeting_date_aprox(pe.metadata ->> 'meeting_date') IS NULL) AS lida
        FROM pipeline_entries pe
        WHERE pe.closed_at IS NULL AND (pe.metadata ->> 'meeting_date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ].*(Z|[+-][0-9]{2}:?[0-9]{2})$'
          AND pg_input_is_valid(pe.metadata ->> 'meeting_date', 'timestamptz')
          AND abs(extract(epoch FROM (pe.metadata ->> 'meeting_date')::timestamptz - public.relogio())) > 2 * 86400) s`)).rows[0];
    assert.ok(longe.total > 50, `controle: poucas datas longe (${longe.total})`);
    assert.equal(longe.lidas, 0);

    // fn_donos_do_lead: o corpo antigo chama por linha; o novo, nunca.
    const chamadas = async db => {
      await db.exec(`SET track_functions = 'all'; SELECT pg_stat_reset();`);
      await db.query('SELECT fn_varredura_avisos_followups()');
      await db.exec('SELECT pg_stat_force_next_flush()');
      return (await db.query(`SELECT coalesce(sum(calls), 0)::int AS n FROM pg_stat_user_functions
        WHERE funcname = 'fn_donos_do_lead'`)).rows[0].n;
    };
    assert.ok(await chamadas(antiga) > 20, 'controle: o corpo antigo chama fn_donos_do_lead por follow-up');
    assert.equal(await chamadas(nova), 0);

    // A expressão do índice roda como quem escreve: authenticated, sem USAGE em private.
    await nova.exec(`GRANT SELECT, INSERT, UPDATE ON pipeline_entries TO authenticated;
      ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC; SET ROLE authenticated;`);
    for (const texto of ['2026-10-19T13:00:00+00:00', '2026-10-19 13:00 Foo/Bar', '2026-10-19T13:00:00+99', 'infinity', 'x'.repeat(5000)]) {
      await nova.query(`INSERT INTO pipeline_entries(id, organization_id, metadata) VALUES (gen_random_uuid(), $1, jsonb_build_object('meeting_date', $2::text))`, [ORG_A, texto]);
    }
    await nova.exec(`UPDATE pipeline_entries SET metadata = metadata || '{"meeting_date":"2026-10-20T10:00:00Z"}' WHERE id = '${id(60001)}'; RESET ROLE;`);
    await nova.exec(`REVOKE EXECUTE ON FUNCTION private.fn_aviso_meeting_date_aprox(text) FROM PUBLIC; SET ROLE authenticated;`);
    await assert.rejects(nova.query(`INSERT INTO pipeline_entries(id, metadata) VALUES (gen_random_uuid(), '{"meeting_date":"2026-10-19"}')`),
      /permission denied for function fn_aviso_meeting_date_aprox/, 'controle: sem o GRANT a escrita quebra');
    await nova.exec('RESET ROLE');
  } finally {
    await antiga.close();
    await nova.close();
  }
});

test('data com fuso inexistente aborta as duas versões igual; migration reaplica e o rollback volta', async () => {
  const t0 = T_MANHA;
  const dados = base(prng(3), t0);
  for (const versao of ['antiga', 'nova']) {
    const db = await banco(versao, dados.sql);
    try {
      await db.exec(`SET test.agora = '${t0.toISOString()}';
        INSERT INTO pipeline_entries VALUES (${q(id(999999))},${q(ORG_A)},${q(dados.leads[0].id)},NULL,NULL,
          '{"meeting_date":"2026-10-19 13:00 Foo/Bar"}',NULL);`);
      await assert.rejects(db.query('SELECT fn_varredura_avisos_reuniao_proxima()'), /time zone "foo\/bar" not recognized/i, versao);
    } finally { await db.close(); }
  }
  const db = await banco('nova', dados.sql);
  try {
    await db.exec(comRelogio(nova)); // idempotente
    await db.exec(rollback);
    const md5 = (await db.query(`SELECT proname, md5(prosrc) AS m FROM pg_proc
      WHERE proname IN ('fn_varredura_avisos_followups','fn_varredura_avisos_reuniao_proxima')`)).rows;
    for (const { proname, m } of md5) assert.equal(m, MD5_PROD[proname], `rollback de ${proname} ≠ prod`);
    const idx = (await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'pipeline_entries' ORDER BY 1`)).rows.map(r => r.indexname);
    assert.ok(idx.includes('pipeline_entries_pending_meeting_reminder_idx'));
    assert.ok(!idx.includes('pipeline_entries_meeting_reminder_at_idx'));
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'fn_aviso_meeting_date_aprox'`)).rows[0].n, 0);
  } finally { await db.close(); }
});
