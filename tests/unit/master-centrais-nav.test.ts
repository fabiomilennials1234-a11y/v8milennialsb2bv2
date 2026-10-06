/**
 * As 5 centrais da Área Dev (board "18 telas → 5 centrais").
 *
 * Trava duas promessas do board:
 *   - nenhuma tela antiga ficou solta: as 18 rotas de antes moram numa central;
 *   - PE-4: cada central tem permissão própria, e as chaves antigas continuam
 *     valendo item a item (o outbounder segue vendo só o que via).
 */
import { describe, expect, it } from "vitest";
import { MASTER_GROUPS, canSeeNavItem } from "@/modules/identity/master/lib/master-nav";

const itens = MASTER_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, central: g.label })));
const centralDe = (path: string) => itens.find((i) => i.path === path)?.central;
const visiveis = (perms: Record<string, unknown>) =>
  MASTER_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canSeeNavItem(i, perms)) })).filter(
    (g) => g.items.length > 0,
  );

describe("as 5 centrais", () => {
  it("são exatamente as do board, com Operação primeiro", () => {
    expect(MASTER_GROUPS.map((g) => g.label)).toEqual([
      "Operação",
      "Implementação",
      "Organizações",
      "Monitoramento",
      "Testes",
    ]);
  });

  it.each([
    ["/master/panorama", "Organizações"], // era o Dashboard
    ["/master/organizations", "Organizações"],
    ["/master/users", "Organizações"],
    ["/master/usuarios-ativos", "Organizações"],
    ["/master/gestores", "Organizações"],
    ["/master/plans", "Organizações"],
    ["/master/features", "Organizações"],
    ["/master/operacao", "Operação"], // era Suporte
    ["/master/onboarding", "Implementação"],
    ["/master/stage-roles", "Implementação"],
    ["/master/audit-logs", "Monitoramento"],
    ["/master/operations", "Monitoramento"],
    ["/master/automation-health", "Monitoramento"],
    ["/master/whatsapp-health", "Monitoramento"],
    ["/master/meta-assets", "Monitoramento"],
    ["/master/oraculo-feedback", "Testes"],
    ["/master/copilot-reasoning", "Testes"],
    ["/master/copilot-toggle-audit", "Testes"],
  ])("%s mora em %s", (path, central) => {
    expect(centralDe(path)).toBe(central);
  });
});

describe("PE-4 — permissão por central", () => {
  it("master pleno vê as 5", () => {
    expect(visiveis({ all: true })).toHaveLength(5);
  });

  it("a chave da central abre a central inteira, menos o que é só de master pleno", () => {
    const testes = visiveis({ testes: true });
    // Panorama não tem chave: todo master vê, por isso Organizações aparece.
    expect(testes.map((g) => g.label)).toEqual(["Organizações", "Testes"]);
    const central = testes.find((g) => g.label === "Testes")!;
    expect(central.items.map((i) => i.path)).not.toContain("/master/oraculo-feedback");
    expect(central.items.map((i) => i.path)).toContain("/master/testes");
  });

  it("a chave antiga `support` continua abrindo os chamados", () => {
    expect(visiveis({ support: true }).map((g) => g.label)).toContain("Operação");
  });

  it("outbounder segue vendo só Organizações (Organizações, Panorama, Usuários)", () => {
    const out = visiveis({ all: false, outbound_only: true, organizations: true, users: true });
    expect(out.map((g) => g.label)).toEqual(["Organizações"]);
    expect(out[0].items.map((i) => i.label)).toEqual(["Organizações", "Panorama", "Usuários"]);
  });
});
