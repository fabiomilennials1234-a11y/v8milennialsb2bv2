import { describe, expect, it } from "vitest";

import { buildSettingsGroup, NAV_VIEW_PERMISSIONS } from "./navigation-model";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_OTHERS_PATH,
  SETTINGS_TABS,
  SETTINGS_TAB_PATHS,
  hostSettingsTab,
  isPrimarySettingsTab,
  resolveSettingsTab,
  settingsTabPath,
  visibleSettingsSections,
  visibleSettingsTabs,
} from "./settings-tabs";

const ADMIN_OUTBOUND = { isAdmin: true, isOutboundOrg: true };
const MEMBRO_INBOUND = { isAdmin: false, isOutboundOrg: false };

const tab = (value: string) => SETTINGS_TABS.find((t) => t.value === value)!;

describe("registro das abas de Configurações", () => {
  it("slugs e values são únicos", () => {
    const slugs = SETTINGS_TABS.map((t) => t.slug);
    const values = SETTINGS_TABS.map((t) => t.value);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(values).size).toBe(values.length);
  });

  /**
   * Sete abas — decisão do CTO de 02/10 (eram quinze, que rolavam na pílula).
   * Se uma oitava aparecer sem passar por essa decisão, este caso avisa.
   */
  it("as abas são exatamente as sete do mockup, na ordem dele", () => {
    expect(SETTINGS_TABS.filter((t) => !t.group && !t.redirect).map((t) => t.label)).toEqual([
      "Tags",
      "Notificações",
      "WhatsApp",
      "Integrações",
      "Assinatura e cobrança",
      "API & Webhooks",
      "Geral",
    ]);
  });

  it("toda aba tem rota própria; seção aponta para a aba que a hospeda", () => {
    expect(settingsTabPath(tab("tags"))).toBe("/configuracoes/tags");
    expect(settingsTabPath(tab("integracoes"))).toBe("/configuracoes/integracoes");
    expect(settingsTabPath(tab("api-webhooks"))).toBe("/configuracoes/api-webhooks");
    expect(settingsTabPath(tab("sla"))).toBe("/configuracoes/geral?secao=sla");
    expect(settingsTabPath(tab("webhooks"))).toBe("/configuracoes/api-webhooks?secao=webhooks");
  });

  it("Checklists saiu das Configurações — o link antigo vai para /checklists", () => {
    expect(settingsTabPath(tab("checklists"))).toBe("/checklists");
    expect(visibleSettingsTabs(ADMIN_OUTBOUND).map((t) => t.value)).not.toContain("checklists");
  });

  it("link antigo de aba que virou seção resolve, e a aba-mãe é a que abre", () => {
    expect(hostSettingsTab(resolveSettingsTab("api-keys")!).value).toBe("api-webhooks");
    expect(hostSettingsTab(resolveSettingsTab("sandbox")!).value).toBe("general");
    expect(hostSettingsTab(resolveSettingsTab("perfil-operacao")!).value).toBe("general");
    // Aba de verdade resolve para ela mesma.
    expect(hostSettingsTab(resolveSettingsTab("whatsapp")!).value).toBe("whatsapp");
  });

  /**
   * A navegação acende item por prefixo em todo o resto do app. Se um slug de
   * rota for prefixo de outro, dois itens do Pitstop ficam ativos ao mesmo tempo.
   */
  it("nenhuma rota de configuração é prefixo de outra", () => {
    for (const a of SETTINGS_TAB_PATHS) {
      for (const b of SETTINGS_TAB_PATHS) {
        if (a === b) continue;
        expect(b.startsWith(`${a}/`)).toBe(false);
      }
    }
  });

  it("toda rota de configuração está na matriz de permissão de view", () => {
    // as sete abas + a porta antiga "Outros", que só redireciona
    expect(SETTINGS_TAB_PATHS).toHaveLength(8);
    expect(SETTINGS_TAB_PATHS).toContain(SETTINGS_OTHERS_PATH);
    for (const path of SETTINGS_TAB_PATHS) {
      expect(NAV_VIEW_PERMISSIONS[path]).toBe("settings.view");
    }
  });

  it("aceita slug de rota e `?tab=`, e recusa o que não conhece", () => {
    expect(resolveSettingsTab("notificacoes")?.value).toBe("notifications");
    expect(resolveSettingsTab("notifications")?.slug).toBe("notificacoes");
    expect(resolveSettingsTab("integracoes")?.value).toBe("integracoes");
    // "outros" é a porta antiga, não uma aba.
    expect(resolveSettingsTab("outros")).toBeNull();
    expect(resolveSettingsTab("inexistente")).toBeNull();
    expect(resolveSettingsTab(null)).toBeNull();
  });

  it("Assinatura só para admin; Marcos só em org outbound; Central de Ajuda só para admin", () => {
    expect(visibleSettingsTabs(MEMBRO_INBOUND).map((t) => t.value)).not.toContain("billing");
    expect(visibleSettingsTabs(ADMIN_OUTBOUND).map((t) => t.value)).toContain("billing");

    const secoesMembro = visibleSettingsSections("general", MEMBRO_INBOUND).map((t) => t.value);
    expect(secoesMembro).not.toContain("marcos");
    expect(secoesMembro).not.toContain("ajuda");

    const secoesAdmin = visibleSettingsSections("general", ADMIN_OUTBOUND).map((t) => t.value);
    expect(secoesAdmin).toContain("marcos");
    expect(secoesAdmin).toContain("ajuda");
  });

  it("a aba padrão vale para todo mundo", () => {
    expect(isPrimarySettingsTab(DEFAULT_SETTINGS_TAB)).toBe(true);
    expect(visibleSettingsTabs(MEMBRO_INBOUND)).toContain(DEFAULT_SETTINGS_TAB);
  });
});

/**
 * O Pitstop é o único caminho de UI até `/configuracoes` no desktop. Sem os
 * itens de configuração nele, a tela fica sem porta.
 */
describe("grupo Configurações do Pitstop", () => {
  it("membro vê as seis abas que pode abrir — sem Assinatura, sem 'Outros'", () => {
    const group = buildSettingsGroup(MEMBRO_INBOUND);
    expect(group.items.map((item) => item.label)).toEqual([
      "Tags",
      "Notificações",
      "WhatsApp",
      "Integrações",
      "API & Webhooks",
      "Geral",
    ]);
    expect(group.items.map((item) => item.path)).toContain("/configuracoes/geral");
  });

  it("admin vê as sete", () => {
    expect(buildSettingsGroup(ADMIN_OUTBOUND).items).toHaveLength(7);
  });

  it("todo item tem rótulo e ícone", () => {
    const group = buildSettingsGroup(ADMIN_OUTBOUND);
    expect(group.items.every((item) => item.label && item.icon)).toBe(true);
  });
});
