import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato das migrations do escopo por usuário na aba Comando.
 *
 * Não substituem teste de integração contra banco — travam as propriedades que
 * a revisão humana erra por distração e que só aparecem em produção.
 */

const MIG = (nome: string) =>
  readFileSync(resolve(__dirname, "../../supabase/migrations", nome), "utf8");

const HELPERS = "20270825000000_is_org_admin_helper.sql";
const CONVERSAS = "20270825000010_comando_conversas_escopo_por_usuario.sql";
const AGENDA = "20270825000020_comando_agenda_escopo_por_usuario.sql";
const TAREFAS = "20270825000030_acoes_do_dia_organization_id.sql";

describe("helpers de escopo", () => {
  const sql = MIG(HELPERS);

  it("is_org_admin é org-aware — o buraco que is_user_admin() tem", () => {
    expect(sql).toMatch(/FUNCTION public\.is_org_admin\(p_organization_id uuid\)/);
    expect(sql).toMatch(/tm\.organization_id = p_organization_id/);
  });

  it("é SECURITY DEFINER, senão a policy de acoes_do_dia recursa no Realtime", () => {
    // Um `SELECT ... FROM team_members` inline na expressão de uma policy causa
    // recursão infinita no `apply_rls()`. O helper DEFINER é o que evita isso.
    expect(sql).toMatch(/is_org_admin[\s\S]*?SECURITY DEFINER/);
  });

  it("master atravessa, como no resto do produto", () => {
    expect(sql).toMatch(/is_master_user\(\)/);
  });

  it("fecha o EXECUTE para PUBLIC e abre só para authenticated/service_role", () => {
    expect(sql).toMatch(/REVOKE ALL\s+ON FUNCTION public\.is_org_admin/);
    expect(sql).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.is_org_admin[\s\S]*authenticated/);
  });
});

describe("conversas — o escopo NÃO viaja na requisição", () => {
  const sql = MIG(CONVERSAS);

  it("a lista de argumentos continua a mesma — sem parâmetro de escopo", () => {
    // 🔒 Esta é a propriedade central: não existe parâmetro para o cliente
    // adulterar. Se alguém acrescentar `p_scope`/`p_only_mine` aqui, a garantia
    // vira "validar o que o cliente mandou" — mais fraca, e o critério de
    // aceite nº 11 passa a depender de um `IF`.
    expect(sql).not.toMatch(/p_scope/);
    expect(sql).not.toMatch(/p_only_mine/);
    expect(sql).toMatch(
      /get_conversations_awaiting_human_reply\(\s*\n?\s*p_org\s+uuid,\s*\n?\s*p_instance\s+uuid,\s*\n?\s*p_limit\s+integer[\s\S]*?p_window_days\s+integer/,
    );
  });

  it("quem decide o escopo é o banco, por is_org_admin", () => {
    expect(sql).toMatch(/is_org_admin\(p_org\)/);
    expect(sql).toMatch(/v_scope_mine\s*:=\s*NOT v_admin/);
  });

  it("DROP antes do CREATE — o RETURNS mudou e overload vira 42725", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.get_conversations_awaiting_human_reply/);
  });

  it("devolve o dono, que é o que o admin precisa ver", () => {
    expect(sql).toMatch(/owner_team_member_id\s+uuid/);
    expect(sql).toMatch(/owner_name\s+text/);
  });

  it("linha sem dono continua visível — 40% da fila está nesse caso", () => {
    // O predicado é escrito na negativa: "esconda só se existir um lead que
    // TENHA dono e o dono NÃO for eu". Se virar um `= v_me` positivo, some 40%
    // da fila de todo vendedor, sem erro nenhum na tela.
    expect(sql).toMatch(/NOT EXISTS/);
    expect(sql).toMatch(/IS NOT NULL[\s\S]*?AND NOT COALESCE\(v_me IN/);
  });

  it("o isolamento por org (chat_restrict_to_owner) segue intacto", () => {
    expect(sql).toMatch(/chat_restrict_to_owner/);
    expect(sql).toMatch(/leads\.view_all/);
    expect(sql).toMatch(/leads\.view_unassigned/);
  });

  it("o contador é calculado DEPOIS do recorte", () => {
    // `waiting_total` alimenta o "e mais N". Contado antes do filtro, o card
    // prometeria conversas que o vendedor nunca conseguiria abrir.
    const posFiltro = sql.indexOf("count(*) OVER ()");
    const posVisivel = sql.indexOf("visivel AS");
    expect(posVisivel).toBeGreaterThan(-1);
    expect(posFiltro).toBeGreaterThan(posVisivel);
  });
});

describe("agenda — compõe, não recria", () => {
  const sql = MIG(AGENDA);

  it("🔴 NÃO recria get_agenda_events — isso apagaria a Source 5 do PROD", () => {
    // O corpo no PROD tem CINCO fontes; o do repo tem QUATRO. A quinta
    // (`meeting_events`, o funil mergeado) foi aplicada à mão em 2026-07-30 e a
    // migration nunca entrou no repo. Um CREATE OR REPLACE escrito a partir do
    // arquivo do repo faria 836 reuniões sumirem da Agenda de novo.
    expect(sql).not.toMatch(/(CREATE|REPLACE)\s+FUNCTION\s+public\.get_agenda_events/);
    expect(sql).toMatch(/FROM public\.get_agenda_events\(/);
  });

  it("normaliza os dois espaços de id antes de comparar pessoa", () => {
    expect(sql).toMatch(/WHEN e\.source = 'meeting' THEN/);
    expect(sql).toMatch(/tm\.user_id\s*=\s*e\.created_by/);
    expect(sql).toMatch(/owner_team_member_id\s+uuid/);
  });

  it("compromisso sem dono continua visível — 61% das confirmações", () => {
    expect(sql).toMatch(/b\.owner_tm IS NULL/);
  });

  it("é função NOVA — /agenda continua vendo a org inteira", () => {
    expect(sql).toMatch(/FUNCTION public\.get_comando_agenda_events/);
  });
});

describe("tarefas — organization_id é pré-requisito da permissão", () => {
  const sql = MIG(TAREFAS);

  it("adiciona organization_id, sem o qual 'admin vê tudo' vaza entre tenants", () => {
    expect(sql).toMatch(/ALTER TABLE public\.acoes_do_dia[\s\S]*ADD COLUMN IF NOT EXISTS organization_id uuid/);
    expect(sql).toMatch(/REFERENCES public\.organizations\(id\)/);
  });

  it("indexa user_id e organization_id", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_acoes_do_dia_user_id/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_acoes_do_dia_organization_id/);
  });

  it("a policy do admin é SÓ de leitura — ver não é mexer", () => {
    expect(sql).toMatch(/CREATE POLICY "Org admins can view team daily actions"[\s\S]*?FOR SELECT/);
    // Se um dia virar FOR ALL, o admin passa a poder concluir e apagar tarefa
    // alheia — escalada que ninguém pediu, e a UI não está preparada.
    expect(sql).not.toMatch(/CREATE POLICY "Org admins[\s\S]*?FOR (ALL|UPDATE|DELETE)/);
  });

  it("linha sem org fica restrita ao dono", () => {
    expect(sql).toMatch(/organization_id IS NOT NULL\s*\n?\s*AND public\.is_org_admin\(organization_id\)/);
  });

  it("o backfill NÃO está na migration — a guarda F4 exige schema puro", () => {
    expect(sql).not.toMatch(/^\s*UPDATE public\.acoes_do_dia/m);
  });
});

describe("tarefas — a janela entre o apply e o backfill", () => {
  // 🔴 Regressão pega na revisão adversarial de 2026-08-24, confirmada por 3
  // céticos independentes.
  //
  // `organization_id = <uuid>` NÃO casa NULL — e, ao contrário de uma coluna
  // inexistente, não levanta erro nenhum: devolve 200 com lista vazia. Como a
  // migration cria a coluna sem DEFAULT e o backfill é script à parte, existe
  // uma janela em que todas as linhas têm org NULL. Um filtro só por org ali
  // zerava o card do ADMIN — inclusive as tarefas dele, que ele via antes
  // desta branch — e a tela ainda afirmava "Ninguém do time tem tarefa
  // aberta".
  //
  // O `.or` conserta pelo lado certo, e este teste existe para que ninguém o
  // "simplifique" de volta para um `.eq` achando que é redundante com o RLS.
  // Não é: o RLS PERMITE a linha; quem a descartava era o WHERE do cliente.
  const hook = readFileSync(
    resolve(__dirname, "../../src/modules/engagement/hooks/useAcoesDoDia.ts"),
    "utf8",
  );

  it("o modo 'tudo' inclui as próprias tarefas como piso, não só as da org", () => {
    expect(hook).toMatch(
      /\.or\(\s*[`'"]organization_id\.eq\.\$\{organizationId\},user_id\.eq\.\$\{user\.id\}/,
    );
  });

  it("o modo 'tudo' NÃO filtra apenas por organization_id", () => {
    expect(hook).not.toMatch(/\.eq\("organization_id"/);
  });

  it("continua degradando para 'as minhas' quando a coluna ainda não existe", () => {
    expect(hook).toMatch(/isMissingColumnError/);
    expect(hook).toMatch(/42703/);
  });
});
