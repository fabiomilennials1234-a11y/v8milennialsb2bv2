/**
 * Fatia "lead vinculado a identidade de Instagram" — O CONTRATO DO BANCO.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  O QUE ESTE ARQUIVO PODE MEDIR, E O QUE ELE NÃO PODE.                     ║
 * ║                                                                          ║
 * ║  A guarda desta fatia mora no BANCO — índice único + três RPCs SECURITY   ║
 * ║  DEFINER. Vitest não abre Postgres, então o comportamento em Postgres de  ║
 * ║  verdade (23505 na segunda reivindicação, 42501 nos gates, RLS avaliada   ║
 * ║  como role `authenticated` — nunca como superuser, que bypassa e dá falso ║
 * ║  verde) é pgTAP: `supabase/tests/lead_social_identities.test.sql`.        ║
 * ║                                                                          ║
 * ║  O que SE PODE cobrar aqui é o ARTEFATO — que a decisão chegou ao         ║
 * ║  repositório NA FORMA DECIDIDA. Este arquivo fica vermelho se alguém      ║
 * ║  "simplificar" o índice para global, trocar `channel_type` por            ║
 * ║  `provider` na chave, tirar um dos quatro gates, deixar a lista lendo o   ║
 * ║  `lead_id` da última mensagem, ou esquecer de reconceder os grants que o  ║
 * ║  DROP do bloco 7 apagou. Um não substitui o outro: pgTAP prova que o      ║
 * ║  banco se comporta; este prova que o desenho não foi diluído no caminho.  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * As asserções são sobre SEMÂNTICA, não sobre redação: o SQL é lido em minúsculas
 * e sem comentários, e os padrões toleram espaço, aspas e quebra de linha. O que
 * elas NÃO toleram é a decisão trocada.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MIGR_DIR = path.resolve(__dirname, "../../supabase/migrations");

/** Acha a migration da fatia por CONTEÚDO, não por nome — o nome pode mudar. */
function acharMigration(): { file: string; sql: string } | null {
  for (const file of readdirSync(MIGR_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (file.startsWith("20260101000000_baseline")) continue;
    const sql = readFileSync(path.join(MIGR_DIR, file), "utf8");
    if (/create\s+table[^;]*lead_social_identities/i.test(sql)) return { file, sql };
  }
  return null;
}

const M = acharMigration();

/** Minúsculas, sem comentários de linha, espaços colapsados. */
const norm = (s: string) =>
  s
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .toLowerCase()
    .replace(/"/g, "")
    .replace(/\s+/g, " ");

const SQL = M ? norm(M.sql) : "";

const FALTA = M
  ? ""
  : "a migration desta fatia ainda não existe em supabase/migrations (nenhum arquivo cria lead_social_identities)";

/**
 * Corpo de uma função, do CREATE até o fechamento do dollar-quote.
 *
 * O rótulo do dollar-quote é CAPTURADO e casado por retrovisor (`$$`, `$function$`,
 * `$body$` — todos valem). Fixar `$$` faria a extração devolver string vazia e todo
 * caso abaixo passaria ou falharia por motivo errado: o pior tipo de vermelho.
 */
function corpo(nome: string): string {
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${nome}\\b[\\s\\S]*?as\\s+\\$([a-z_]*)\\$[\\s\\S]*?\\$\\1\\$`,
    "g",
  );
  return (SQL.match(re) ?? []).join("\n");
}

const LINK = "link_social_conversation_to_lead";
const GUARD = "can_link_or_read_lead";
const CREATE = "create_lead_from_social_conversation";
const UNLINK = "unlink_social_conversation_from_lead";
const LISTA = "get_social_conversation_list";

// ─── 0. o artefato ───────────────────────────────────────────────────────────

describe("0. a migration da fatia", () => {
  it("existe e cria `lead_social_identities`", () => {
    expect(M, FALTA).not.toBeNull();
    expect(SQL).toMatch(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?lead_social_identities/);
  });

  it("nenhum timestamp de migration colide com outro no diretório", () => {
    // Guarda de memória cara: a CLI PULA em silêncio a segunda migration de mesmo
    // timestamp e o ledger dá falso verde. Este caso passa hoje e é o que impede
    // a nova entrar com um prefixo já usado.
    const prefixos = readdirSync(MIGR_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0]);
    const duplicados = prefixos.filter((p, i) => prefixos.indexOf(p) !== i);
    expect(duplicados).toEqual([]);
  });
});

// ─── 1. UNICIDADE — dois leads não reivindicam o mesmo IGSID ────────────────

describe("1. a guarda de unicidade da identidade", () => {
  /** Lista de colunas de cada UNIQUE INDEX sobre a tabela. */
  const indicesUnicos = () =>
    [...SQL.matchAll(/create\s+unique\s+index[^;]*?on\s+(?:public\.)?lead_social_identities\s*\(([^)]*)\)/g)].map(
      (m) => m[1].split(",").map((c) => c.trim()),
    );

  it("existe exatamente um índice ÚNICO sobre a tabela", () => {
    expect(indicesUnicos(), FALTA).toHaveLength(1);
  });

  it("a chave é (organization_id, channel_type, external_user_id)", () => {
    // É ESTA a guarda que impede dois leads da mesma org de reivindicarem o mesmo
    // IGSID — e é a ÚNICA da fatia: `idx_leads_org_phone_unique` é parcial em
    // `normalized_phone` e um lead de Instagram não tem telefone, então ele não
    // pega nada. (Provado em `notificame-lead-sem-telefone.test.ts`.)
    expect(indicesUnicos()[0] ?? [], FALTA).toEqual([
      "organization_id",
      "channel_type",
      "external_user_id",
    ]);
  });

  it("a unicidade é POR ORG — nunca global", () => {
    // Global recusaria o caso normal do B2B (a mesma fábrica falando com dois
    // clientes nossos) e, pior, o 23505 contaria à org B que a org A já tem
    // aquela pessoa: índice único é canal de informação cross-tenant.
    expect(indicesUnicos()[0] ?? [], FALTA).toContain("organization_id");
  });

  it("`provider` NÃO entra na chave — o IGSID é escopado pela plataforma", () => {
    // Se o mesmo id chegar amanhã pela Meta direto em vez do NotificaMe, ter
    // `provider` na chave criaria um SEGUNDO lead para a MESMA pessoa.
    expect(indicesUnicos()[0] ?? [], FALTA).not.toContain("provider");
  });

  it("NÃO existe unique em (lead_id, channel_type) — uma pessoa pode ter duas contas", () => {
    expect(SQL).not.toMatch(/unique[^;]*\(\s*lead_id\s*,\s*channel_type\s*\)/);
  });

  it("as colunas de identidade são NOT NULL e o lead some junto (CASCADE)", () => {
    expect(SQL, FALTA).toMatch(/external_user_id\s+text\s+not\s+null/);
    expect(SQL).toMatch(/lead_id\s+uuid\s+not\s+null\s+references\s+(?:public\.)?leads\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/);
    expect(SQL).toMatch(/organization_id\s+uuid\s+not\s+null\s+references\s+(?:public\.)?organizations/);
  });

  it("`channel_type` recusa 'whatsapp' — WhatsApp tem identidade em normalized_phone", () => {
    expect(SQL, FALTA).toMatch(/channel_type[^,]*check\s*\([^)]*in\s*\(\s*'instagram'\s*,\s*'facebook'\s*\)/);
  });

  it("`handle` NÃO é chave — o @ muda, o IGSID não", () => {
    const chave = indicesUnicos()[0] ?? [];
    expect(chave, FALTA).not.toContain("handle");
    expect(chave).not.toContain("display_name");
  });
});

// ─── 2. VÍNCULO — o histórico da conversa passa a apontar para o lead ───────

describe("2. vincular a lead existente aponta o histórico", () => {
  it("a RPC de vínculo faz UPDATE em channel_messages SET lead_id", () => {
    // PASSADO da thread. Só a DEFINER consegue: `authenticated` ficou SELECT-only
    // em `channel_messages` desde 20270815104500 — não existe versão front-only.
    expect(corpo(LINK), FALTA).toMatch(/update\s+(?:public\.)?channel_messages(?:\s+(?:as\s+)?[a-z_]+)?\s+set\s+lead_id\s*=/);
  });

  it("o UPDATE é escopado por org E pelo IGSID da thread — não varre a caixa", () => {
    const b = corpo(LINK);
    expect(b, FALTA).toMatch(/update[\s\S]*?channel_messages[\s\S]*?organization_id\s*=/);
    expect(b).toMatch(/update[\s\S]*?channel_messages[\s\S]*?contact_external_id\s*=/);
  });

  it("criar-e-vincular também backfilla a thread — um ato só", () => {
    expect(corpo(CREATE), FALTA).toMatch(/update\s+(?:public\.)?channel_messages(?:\s+(?:as\s+)?[a-z_]+)?\s+set\s+lead_id\s*=/);
  });

  it("desvincular devolve a thread para NULL", () => {
    expect(corpo(UNLINK), FALTA).toMatch(/update\s+(?:public\.)?channel_messages(?:\s+(?:as\s+)?[a-z_]+)?\s+set\s+lead_id\s*=\s*null/);
  });

  it("a LISTA passa a ler a identidade — e não o lead_id da última mensagem", () => {
    // Sem isto o vínculo SUMIRIA na próxima mensagem recebida: o writer grava
    // `lead_id` resolvido, e uma thread cuja última linha nasceu antes do vínculo
    // devolveria NULL. A identidade é a fonte da verdade; a coluna é cache.
    const b = corpo(LISTA);
    expect(b, FALTA).toMatch(/lead_social_identities/);
    expect(b).toMatch(/lead_name/);
  });

  it("a lista esconde lead na lixeira (`deleted_at IS NULL`)", () => {
    expect(corpo(LISTA), FALTA).toMatch(/deleted_at\s+is\s+null/);
  });

  it("o vínculo também recusa lead na lixeira", () => {
    // A checagem MUDOU DE LUGAR, não sumiu: `link_social_conversation_to_lead`
    // delega a `can_link_or_read_lead`, que espelha a policy de `leads`. Cobrar a
    // forma antiga (o SELECT inline) travaria a refatoração em vez do invariante.
    // Aqui cobramos os dois: que o vínculo CHAMA o helper, e que o helper recusa
    // lixeira.
    expect(corpo(LINK), FALTA).toMatch(/can_link_or_read_lead/);
    expect(corpo(GUARD), FALTA).toMatch(/deleted_at\s+is\s+null/);
  });

  it("a trilha do vínculo é registrada em lead_history", () => {
    // "Quem vinculou essa conversa a esse lead?" tem que nascer com resposta.
    expect(corpo(LINK), FALTA).toMatch(/insert\s+into\s+(?:public\.)?lead_history/);
  });
});

// ─── 3. QUEM CRIA — usuário autorizado da org, e a org vem do auth ─────────

describe("3. criar lead exige usuário autorizado, e a org é conferida contra o auth", () => {
  it.each([LINK, CREATE, UNLINK])("%s é SECURITY DEFINER com search_path fixo", (fn) => {
    const b = corpo(fn);
    expect(b, FALTA).toMatch(/security\s+definer/);
    expect(b).toMatch(/set\s+search_path/);
  });

  it.each([LINK, CREATE, UNLINK])("%s confere a org contra o auth do chamador", (fn) => {
    // O `p_org` que o cliente manda NÃO é confiança: ele é CONFERIDO contra as
    // orgs do `auth.uid()`. Sem isso, DEFINER + authenticated = cross-tenant.
    expect(corpo(fn), FALTA).toMatch(/get_my_organization_ids\s*\(\s*\)/);
  });

  it.each([LINK, CREATE, UNLINK])("%s confere que o canal pertence à org", (fn) => {
    // Sem este gate, um membro legítimo lê e escreve a caixa do vizinho só
    // passando o uuid do canal dele.
    expect(corpo(fn), FALTA).toMatch(/messaging_channels[\s\S]*?organization_id/);
  });

  it("vincular confere que o LEAD pertence à org", () => {
    // Sem ele, um membro aponta a conversa dela para um lead de OUTRA org.
    // O predicado vive no helper — ver o caso da lixeira acima.
    expect(corpo(LINK), FALTA).toMatch(/can_link_or_read_lead/);
    expect(corpo(GUARD), FALTA).toMatch(/from\s+(?:public\.)?leads[\s\S]*?organization_id/);
  });

  // ⚠️ ESTE é o caso que o achado adversarial destravou. Org NÃO BASTA: estas RPCs
  // são DEFINER e bypassam a RLS de `leads`. Sem o predicado de VISIBILIDADE, um
  // vendedor sem `leads.view_all` e sem responsabilidade pega um `lead_id` da lista
  // de WhatsApp (que já o entrega), vincula numa conversa de IG qualquer, e passa a
  // LER o nome daquele lead no badge da lista social.
  it("o helper de visibilidade ESPELHA a policy de leads, não inventa regra", () => {
    const g = corpo(GUARD);
    expect(g, FALTA).toMatch(/leads\.view_all/);
    expect(g).toMatch(/is_user_responsible/);
    expect(g).toMatch(/can_see_lead_by_permissions/);
    expect(g).toMatch(/is_user_responsible_in_any_pipe/);
    expect(g).toMatch(/is_user_admin/);
    expect(g).toMatch(/is_master_user/);
  });

  it("a LISTA só entrega o nome do lead a quem pode vê-lo", () => {
    // O `lead_id` continua saindo (a UI precisa saber que há vínculo). O que o
    // predicado protege é o NOME, que a policy de `leads` esconde.
    expect(corpo(LISTA), FALTA).toMatch(/can_link_or_read_lead/);
  });

  it("CRIAR exige a permissão `leads.create` no SERVIDOR", () => {
    // Hoje `useCanDo('create_lead')` só decide no cliente e a policy
    // `leads_insert_organization` não checa papel nenhum. Esta é a primeira vez
    // que a chave é cobrada onde não dá para contornar.
    expect(corpo(CREATE), FALTA).toMatch(/has_feature_permission\s*\(\s*'leads\.create'/);
  });

  it.each([LINK, CREATE, UNLINK])("%s recusa com 42501 (insufficient_privilege)", (fn) => {
    expect(corpo(fn), FALTA).toMatch(/errcode\s*=\s*'42501'/);
  });

  it("o RESPONSÁVEL vem do auth, não de parâmetro", () => {
    const b = corpo(CREATE);
    expect(b, FALTA).toMatch(/auth\.uid\s*\(\s*\)/);
    expect(b).toMatch(/team_members/);
    // Aceitar `p_responsible_id` do cliente deixaria um membro carimbar lead no
    // nome de outro — e o `linked_by` da trilha viraria ficção.
    expect(b).not.toMatch(/p_responsible_id/);
    expect(b).not.toMatch(/p_linked_by/);
    expect(b).not.toMatch(/p_created_by/);
  });

  it("nome obrigatório NO SERVIDOR — `'   '` não passa", () => {
    const b = corpo(CREATE);
    // Trim no servidor + recusa explícita. O front pré-preenche, mas um cliente
    // que mande '' produziria um lead sem rótulo, irreconhecível em qualquer lista.
    expect(b, FALTA).toMatch(/btrim\s*\(\s*(?:coalesce\s*\(\s*)?p_name/);
    expect(b).toMatch(/raise\s+exception\s+'name[^']*required'/);
  });
});

// ─── 4. O LEAD QUE NASCE — sem telefone, com origem e com funil ────────────

describe("4. o lead nasce sem telefone, visível, e sem vocabulário novo", () => {
  it("`p_phone` é OPCIONAL e default NULL", () => {
    expect(corpo(CREATE), FALTA).toMatch(/p_phone\s+text\s+default\s+null/);
  });

  it("telefone vazio vira NULL — o `''` é DESARMADO antes do INSERT", () => {
    // `''` sairia do alcance de `.is('phone', null)`, o caminho que adota o
    // telefone quando a pessoa aparece depois no WhatsApp — o lead ficaria para
    // sempre sem telefone, em silêncio. Ver `notificame-lead-sem-telefone.test.ts`.
    //
    // A asserção cobra o NULLIF (ou equivalente), não a ausência de COALESCE:
    // `NULLIF(btrim(COALESCE(p_phone,'')),'')` usa os dois e está CERTO.
    const b = corpo(CREATE);
    expect(b, FALTA).toMatch(/nullif\s*\([^;]{0,80}p_phone/);
    expect(b).not.toMatch(/values[\s\S]*?coalesce\s*\(\s*p_phone\s*,\s*''\s*\)\s*,/);
  });

  it("origem 'instagram' — valor que o enum lead_origin já tem", () => {
    expect(corpo(CREATE), FALTA).toMatch(/'instagram'/);
  });

  it("o lead ENTRA em funil na mesma transação, e a RPC decide o destino", () => {
    // Lead invisível é pior que lead sem telefone: é a patologia "feature
    // construída e nunca ligada".
    expect(corpo(CREATE), FALTA).toMatch(/insert\s+into\s+(?:public\.)?pipeline_entries/);
  });

  it("o GUC desliga o trigger de funil default — senão a corrida se perde", () => {
    // `trg_auto_assign_lead_default_pipe` é CONSTRAINT TRIGGER DEFERRABLE: sem
    // `SET LOCAL app.skip_default_pipe='1'` ele semeia whatsapp/novo no COMMIT e o
    // lead acaba em DOIS funis.
    const b = corpo(CREATE);
    expect(b, FALTA).toMatch(/app\.skip_default_pipe/);
    // LOCAL é o que importa, e há duas formas legítimas de dizê-lo: `SET LOCAL` ou
    // `set_config(..., true)`. Escopo de SESSÃO vazaria o GUC para a próxima query
    // da mesma conexão — e o pooler reusa conexão entre requisições.
    expect(b).toMatch(
      /(set\s+local\s+app\.skip_default_pipe\s*=\s*'1'|set_config\s*\(\s*'app\.skip_default_pipe'\s*,\s*'1'\s*,\s*true\s*\))/,
    );
  });

  it("criação e identidade estão na MESMA função — logo, na mesma transação", () => {
    // Se o INSERT do lead ficasse no front e o vínculo numa segunda chamada, dois
    // cliques produziriam dois leads e um órfão, e NENHUM índice pegaria isso.
    expect(corpo(CREATE), FALTA).toMatch(/insert\s+into\s+(?:public\.)?leads/);
    expect(corpo(CREATE)).toMatch(/insert\s+into\s+(?:public\.)?lead_social_identities/);
  });
});

// ─── 5. GRANTS — o risco declarado do DROP+CREATE ──────────────────────────

describe("5. grants: as QUATRO funções, não as três novas", () => {
  it.each([LINK, CREATE, UNLINK])("%s é revogada de PUBLIC/anon e concedida a authenticated", (fn) => {
    // CREATE FUNCTION reconcede EXECUTE a PUBLIC e, por default privilege do
    // Supabase, a anon.
    expect(SQL, FALTA).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function[^;]*${fn}[^;]*from[^;]*public`));
    expect(SQL).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function[^;]*${fn}[^;]*anon`));
    expect(SQL).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function[^;]*${fn}[^;]*to[^;]*authenticated`));
  });

  it("get_social_conversation_list é RE-concedida depois do DROP", () => {
    // O DROP do bloco de recriação APAGA os grants dela. O esquecimento é
    // silencioso: a lista continua funcionando para authenticated e ganha
    // superfície para anon.
    expect(SQL, FALTA).toMatch(new RegExp(`drop\\s+function[^;]*${LISTA}`));
    expect(SQL).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function[^;]*${LISTA}[^;]*anon`));
    expect(SQL).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function[^;]*${LISTA}[^;]*to[^;]*authenticated`));
  });

  it("nenhuma das quatro é concedida a anon", () => {
    for (const fn of [LINK, CREATE, UNLINK, LISTA]) {
      expect(
        new RegExp(`grant\\s+execute\\s+on\\s+function[^;]*${fn}[^;]*to[^;]*anon`).test(SQL),
        `${fn} concedida a anon`,
      ).toBe(false);
    }
  });
});

// ─── 6. A TABELA — leitura sob RLS, escrita só por DEFINER ─────────────────

describe("6. a tabela de identidade é lida pela org e escrita por ninguém", () => {
  it("RLS ligada, com policy de SELECT pela org (ou master)", () => {
    expect(SQL, FALTA).toMatch(/alter\s+table\s+(?:public\.)?lead_social_identities\s+enable\s+row\s+level\s+security/);
    expect(SQL).toMatch(/create\s+policy[\s\S]*?lead_social_identities[\s\S]*?get_my_organization_ids/);
  });

  it("`authenticated` recebe SELECT e mais nada — grant de tabela domina policy", () => {
    // Mesmo bloco de `messaging_channels`: sem o REVOKE, um membro faz UPDATE
    // direto pelo PostgREST e ROUBA a identidade para outro lead, sem passar por
    // nenhum dos quatro gates.
    expect(SQL, FALTA).toMatch(/revoke\s+all\s+on\s+(?:table\s+)?(?:public\.)?lead_social_identities\s+from[^;]*authenticated/);
    expect(SQL).toMatch(/grant\s+select\s+on\s+(?:table\s+)?(?:public\.)?lead_social_identities\s+to\s+authenticated/);
    expect(SQL).not.toMatch(/grant[^;]*\b(insert|update|delete)\b[^;]*lead_social_identities[^;]*to[^;]*authenticated/);
  });
});
