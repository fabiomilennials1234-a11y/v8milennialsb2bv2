/**
 * templates-aprovados — quais Templates são escolhíveis, num lugar só (#1722).
 *
 * A pergunta "que templates esta conta pode disparar" passa a ter DOIS
 * consumidores: o nó de Workflow (#1688/#1689) e o passo de conteúdo do Disparo.
 * É exatamente a forma do defeito que o #1722 conserta uma camada acima — três
 * telas decidindo sozinhas quais NÚMEROS existiam. Não vou repetir o padrão com
 * TEMPLATES.
 */
import { describe, it, expect } from "vitest";
import {
  apenasAprovados,
  contaListaTemplates,
} from "@/modules/communication/lib/templates-aprovados";

const t = (name: string, status: string) => ({ name, status }) as never;

describe("apenasAprovados", () => {
  it("deixa passar só APPROVED", () => {
    // Um template em análise não é opção, é espera. Listá-lo como escolhível
    // entrega uma recusa certa no dia em que o Disparo rodar — e no Canal
    // Oficial a recusa chega por callback, depois do envio parecer ter dado
    // certo.
    const lista = [
      t("aprovado", "APPROVED"),
      t("em_analise", "PENDING"),
      t("recusado", "REJECTED"),
      t("pausado", "PAUSED"),
      t("desabilitado", "DISABLED"),
    ];
    expect(apenasAprovados(lista).map((x) => x.name)).toEqual(["aprovado"]);
  });

  it("lista ausente vira lista vazia, não estouro", () => {
    expect(apenasAprovados(undefined)).toEqual([]);
    expect(apenasAprovados(null)).toEqual([]);
  });
});

describe("contaListaTemplates", () => {
  it("só o NotificaMe — é a conta cuja listagem nós sabemos ler", () => {
    // ⚠️ Mais estreito que `capabilities.templates` DE PROPÓSITO: `meta_cloud`
    // também tem templates aprovados, mas os dele não saem por
    // `useNotificameTemplates`. Listar um pelo outro devolveria lista errada, ou
    // vazia, sem dizer por quê.
    expect(contaListaTemplates("notificame")).toBe(true);
    expect(contaListaTemplates("meta_cloud")).toBe(false);
    expect(contaListaTemplates("uazapi")).toBe(false);
    expect(contaListaTemplates(undefined)).toBe(false);
  });
});

describe("guarda — ninguém refiltra por conta própria", () => {
  const TELAS = [
    "src/modules/workflows/components/action-configs/TemplateNodeConfig.tsx",
    "src/modules/campaigns/components/disparo-wizard/StepMessage.tsx",
  ];

  it.each(TELAS)("%s usa o módulo, não um filtro local", async (arquivo) => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(arquivo, "utf8");
    expect(src).toMatch(/apenasAprovados/);
    // A comparação literal duplicada é a marca da divergência.
    expect(src).not.toMatch(/status\s*===\s*"APPROVED"/);
  });
});
