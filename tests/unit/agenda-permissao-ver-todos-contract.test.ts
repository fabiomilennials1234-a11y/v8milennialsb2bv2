import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contrato da migration que torna a Agenda org-wide por padrão e transforma o
 * recorte "só as minhas" em permissão.
 *
 * Não substitui teste contra banco — trava as propriedades que a revisão humana
 * erra por distração e que só apareceriam em produção, com o dado do colega já
 * na tela de quem não podia ver (ou a agenda de todo mundo vazia).
 */

const SQL = readFileSync(
  resolve(
    __dirname,
    "../../supabase/migrations/20270914000000_agenda_de_todos_por_permissao.sql",
  ),
  "utf8",
);

describe("a chave de catálogo", () => {
  it("nasce LIGADA — a agenda da operação é o padrão, não o prêmio", () => {
    expect(SQL).toMatch(/'agenda\.view_all'[\s\S]*?false, true, 15/);
  });

  it("não é admin-only: admin-only devolveria false para todo membro", () => {
    // `has_feature_permission` corta em `IF v_admin_only THEN RETURN false`,
    // antes de olhar override e default da org — a permissão viraria decorativa.
    expect(SQL).toMatch(/is_admin_only\s*=\s*EXCLUDED\.is_admin_only/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'agenda\.view_all admin-only/);
  });

  it("corrige em vez de ignorar: ON CONFLICT DO UPDATE, não DO NOTHING", () => {
    // Lido só do INSERT, não do arquivo: o cabeçalho CITA "DO NOTHING" ao
    // explicar por que não é isso que a migration faz.
    const insert = SQL.match(/INSERT INTO public\.feature_permissions[\s\S]*?;\n/);
    expect(insert).not.toBeNull();
    expect(insert![0]).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(insert![0]).not.toMatch(/DO NOTHING/);
  });

  it("a guarda reprova o apply se o default vier desligado", () => {
    expect(SQL).toMatch(/v_default IS DISTINCT FROM true/);
  });
});

describe("o recorte vive no banco", () => {
  it("compõe sobre get_agenda_events em vez de reescrevê-la", () => {
    // O corpo da base no PROD já divergiu do repo mais de uma vez; um
    // CREATE OR REPLACE escrito a partir do arquivo apagaria fonte viva.
    expect(SQL).toMatch(/FROM public\.get_agenda_events\(p_organization_id, p_start, p_end\)/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.get_agenda_events\(/);
  });

  it("a lista de argumentos NÃO tem parâmetro de escopo", () => {
    // 🔒 Propriedade central: não existe `p_scope`/`p_only_mine` para o cliente
    // adulterar. O escopo é decidido dentro da função, a partir da sessão.
    const assinatura = SQL.match(
      /FUNCTION public\.get_agenda_events_scoped\(([\s\S]*?)\)\s*RETURNS/,
    );
    expect(assinatura).not.toBeNull();
    expect(assinatura![1]).toMatch(/p_organization_id[\s\S]*p_start[\s\S]*p_end/);
    expect(assinatura![1]).not.toMatch(/scope|only_mine|p_user|p_team_member/i);
  });

  it("admin e master atravessam ANTES da permissão", () => {
    // Master e gestor não têm linha em `team_members`, e
    // `has_feature_permission` devolve false para quem não tem linha: sem o
    // `is_org_admin` na frente, quem opera a org de fora veria só os órfãos.
    expect(SQL).toMatch(
      /v_scope_mine\s*:=\s*NOT public\.is_org_admin\(p_organization_id\)[\s\S]*?has_feature_permission\('agenda\.view_all'/,
    );
  });

  it("normaliza o dono: `meeting` casa por user_id, as outras por team_members.id", () => {
    // Comparar `created_by` cru contra um id só some com metade da agenda, sem
    // erro nenhum — as fontes carregam DOIS espaços de id na mesma coluna.
    expect(SQL).toMatch(/WHEN e\.source = 'meeting' THEN[\s\S]*?tm\.user_id\s*=\s*e\.created_by/);
    expect(SQL).toMatch(/ELSE e\.created_by/);
  });

  it("a ponte user_id → team_members é escopada por org (senão dá fanout)", () => {
    // `team_members.user_id` não é único: um master tem uma linha por org.
    expect(SQL).toMatch(/tm\.user_id\s*=\s*e\.created_by[\s\S]*?tm\.organization_id\s*=\s*p_organization_id/);
  });

  it("as três portas do recorte estão todas lá", () => {
    expect(SQL).toMatch(/b\.owner_tm\s*=\s*v_me/);          // é meu
    expect(SQL).toMatch(/b\.owner_tm IS NULL/);              // não é de ninguém
    expect(SQL).toMatch(/public\.meeting_participants mp/);  // fui convidado
    expect(SQL).toMatch(/pc\.sdr_id\s*=\s*v_me/);            // eu marquei, o closer levou o crédito
  });

  it("v_me nulo nunca vira filtro — master não pode receber agenda vazia", () => {
    expect(SQL).toMatch(/v_me IS NOT NULL AND b\.owner_tm = v_me/);
  });

  it("gate de tenancy devolve erro legível em vez de lista vazia", () => {
    expect(SQL).toMatch(/get_my_organization_ids\(\)/);
    expect(SQL).toMatch(/forbidden: org not accessible/);
  });

  it("fecha o EXECUTE para PUBLIC e anon, abre para authenticated", () => {
    expect(SQL).toMatch(/REVOKE ALL\s+ON FUNCTION public\.get_agenda_events_scoped/);
    expect(SQL).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_agenda_events_scoped[\s\S]*?FROM anon/);
    expect(SQL).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.get_agenda_events_scoped[\s\S]*?authenticated/);
  });
});

describe("o front chama a função com recorte", () => {
  const HOOK = readFileSync(
    resolve(__dirname, "../../src/modules/engagement/hooks/useAgendaEvents.ts"),
    "utf8",
  );
  const TELA = readFileSync(
    resolve(
      __dirname,
      "../../src/modules/engagement/components/agenda/AgendaAtividades.tsx",
    ),
    "utf8",
  );

  it("a tela pede a RPC com recorte, e só cai na base se ela não existir", () => {
    expect(HOOK).toMatch(/get_agenda_events_scoped/);
    expect(HOOK).toMatch(/PGRST202/);
  });

  it("o escopo da tela é a permissão, não o cargo", () => {
    expect(TELA).toMatch(/useCanDo\("agenda\.view_all"\)/);
    expect(TELA).toMatch(/isAdmin \|\| podeVerTodos/);
  });

  it("falha fechado enquanto identidade ou permissão carregam", () => {
    expect(TELA).toMatch(/identityReady && !permissaoCarregando/);
  });
});
