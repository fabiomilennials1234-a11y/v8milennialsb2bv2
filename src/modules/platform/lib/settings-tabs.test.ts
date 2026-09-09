import { describe, expect, it } from "vitest";

import { buildSettingsGroup, NAV_VIEW_PERMISSIONS } from "./navigation-model";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_OTHERS_PATH,
  SETTINGS_TABS,
  SETTINGS_TAB_PATHS,
  isPrimarySettingsTab,
  resolveSettingsTab,
  settingsTabPath,
  visibleOtherSettingsTabs,
  visiblePrimarySettingsTabs,
  visibleSettingsTabs,
} from "./settings-tabs";

const ADMIN_OUTBOUND = { isAdmin: true, isOutboundOrg: true };
const MEMBRO_INBOUND = { isAdmin: false, isOutboundOrg: false };

describe("registro das abas de Configurações", () => {
  it("slugs e values são únicos", () => {
    const slugs = SETTINGS_TABS.map((t) => t.slug);
    const values = SETTINGS_TABS.map((t) => t.value);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(values).size).toBe(values.length);
  });

  /**
   * Só três abas viram rota — decisão do CTO. Se uma quarta ganhar `primary`
   * sem passar por essa decisão, este caso avisa.
   */
  it("apenas Tags, Notificações e WhatsApp são primárias", () => {
    expect(SETTINGS_TABS.filter(isPrimarySettingsTab).map((t) => t.value)).toEqual([
      "tags",
      "notifications",
      "whatsapp",
    ]);
  });

  it("primária tem rota própria; o resto mora em Outros com `?tab=`", () => {
    expect(settingsTabPath(SETTINGS_TABS[0])).toBe("/configuracoes/tags");
    expect(settingsTabPath(SETTINGS_TABS[1])).toBe("/configuracoes/notificacoes");
    expect(settingsTabPath(SETTINGS_TABS[2])).toBe("/configuracoes/whatsapp");

    for (const tab of SETTINGS_TABS.filter((t) => !isPrimarySettingsTab(t))) {
      expect(settingsTabPath(tab)).toBe(`${SETTINGS_OTHERS_PATH}?tab=${tab.value}`);
    }
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
    expect(SETTINGS_TAB_PATHS).toHaveLength(4); // as três primárias + Outros
    for (const path of SETTINGS_TAB_PATHS) {
      expect(NAV_VIEW_PERMISSIONS[path]).toBe("settings.view");
    }
  });

  it("aceita slug de rota e `?tab=`, e recusa o que não conhece", () => {
    expect(resolveSettingsTab("notificacoes")?.value).toBe("notifications");
    expect(resolveSettingsTab("notifications")?.slug).toBe("notificacoes");
    expect(resolveSettingsTab("whatsapp")?.value).toBe("whatsapp");
    // Link antigo para uma aba que hoje mora em Outros ainda resolve — é assim
    // que `/configuracoes?tab=integracoes` continua abrindo Integrações.
    expect(resolveSettingsTab("integracoes")?.value).toBe("integracoes");
    // "outros" é a porta, não uma aba: quem resolve o conteúdo é o `?tab=`.
    expect(resolveSettingsTab("outros")).toBeNull();
    expect(resolveSettingsTab("inexistente")).toBeNull();
    expect(resolveSettingsTab(null)).toBeNull();
  });

  it("Marcos só em org outbound; Central de Ajuda só para admin", () => {
    const membro = visibleSettingsTabs(MEMBRO_INBOUND).map((t) => t.value);
    expect(membro).not.toContain("marcos");
    expect(membro).not.toContain("ajuda");

    const admin = visibleSettingsTabs(ADMIN_OUTBOUND).map((t) => t.value);
    expect(admin).toContain("marcos");
    expect(admin).toContain("ajuda");
  });

  it("o gating não alcança as primárias — elas valem para todo mundo", () => {
    expect(visiblePrimarySettingsTabs(MEMBRO_INBOUND)).toHaveLength(3);
    expect(visiblePrimarySettingsTabs(MEMBRO_INBOUND)).toContain(DEFAULT_SETTINGS_TAB);
    expect(visibleOtherSettingsTabs(ADMIN_OUTBOUND).length).toBeGreaterThan(
      visibleOtherSettingsTabs(MEMBRO_INBOUND).length,
    );
  });
});

/**
 * Guarda do buraco que esta mudança fechou: no desktop o gatilho do Pitstop só
 * abre o painel — não navega. Sem itens de configuração no painel, a tela
 * `/configuracoes` não tem nenhum caminho de UI.
 */
describe("grupo Configurações do Pitstop", () => {
  it("mostra as três primárias e uma porta para Outros — nada além", () => {
    const group = buildSettingsGroup(MEMBRO_INBOUND);

    expect(group.items.map((item) => item.label)).toEqual([
      "Tags",
      "Notificações",
      "WhatsApp",
      "Outros",
    ]);
    expect(group.items.map((item) => item.path)).toEqual([
      "/configuracoes/tags",
      "/configuracoes/notificacoes",
      "/configuracoes/whatsapp",
      SETTINGS_OTHERS_PATH,
    ]);
  });

  it("não cresce com o inventário: admin de org outbound vê os mesmos 4 itens", () => {
    expect(buildSettingsGroup(ADMIN_OUTBOUND).items).toHaveLength(4);
  });

  it("todo item tem rótulo e ícone", () => {
    const group = buildSettingsGroup(ADMIN_OUTBOUND);
    expect(group.items.every((item) => item.label && item.icon)).toBe(true);
  });
});
