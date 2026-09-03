import { describe, it, expect } from "vitest";

import {
  type SystemPipeDisplay,
  NOME_DE_FABRICA,
  PIPE_TYPE_PARA_DESTINO,
  destinosDeSistema,
  nomeDoFunil,
} from "@/contracts/pipe";
import { SYSTEM_PIPE_CATALOG } from "../hooks/config/usePipelineDisplayConfig";
import { DEST_TO_PIPE_TYPE } from "@/lib/lead/lead-destinations";

/**
 * O teste mora em `pipelines`, e não ao lado do código em `contracts`, porque a
 * guarda que mais importa é o ESPELHO: `NOME_DE_FABRICA` (contracts, folha do
 * grafo) tem de bater com `SYSTEM_PIPE_CATALOG` (pipelines, onde o produto
 * decide quais funis existem). Só daqui dá para enxergar os dois.
 */

const cfg = (
  pipe_type: string,
  display_name: string,
  extra: Partial<SystemPipeDisplay> = {},
): SystemPipeDisplay => ({
  pipe_type,
  display_name,
  is_visible: true,
  position: 1,
  ...extra,
});

describe("nomeDoFunil", () => {
  it("usa o display_name da org, não o pipelines.name congelado do seed", () => {
    const configs = [cfg("whatsapp", "Oportunidades")];
    // É exatamente este par que o cadastro de lead exibia errado: o banco diz
    // "Qualificação", a org chama de "Oportunidades".
    expect(
      nomeDoFunil(configs, { name: "Qualificação", slug: "whatsapp", type: "system" }),
    ).toBe("Oportunidades");
  });

  it("respeita o nome que a org escolheu, e não o padrão de fábrica", () => {
    const configs = [cfg("whatsapp", "Entrada de Obra")];
    expect(
      nomeDoFunil(configs, { name: "Qualificação", slug: "whatsapp", type: "system" }),
    ).toBe("Entrada de Obra");
  });

  it("cai no nome de fábrica quando a org não tem linha de display", () => {
    expect(
      nomeDoFunil([], { name: "Qualificação", slug: "whatsapp", type: "system" }),
    ).toBe("Oportunidades");
  });

  it("devolve pipelines.name para funil custom — ali o nome já é o do usuário", () => {
    const configs = [cfg("whatsapp", "Oportunidades")];
    expect(
      nomeDoFunil(configs, { name: "Pós-venda", slug: null, type: "custom" }),
    ).toBe("Pós-venda");
  });

  it("não quebra com configs indefinido (primeiros renders, antes da query)", () => {
    expect(
      nomeDoFunil(undefined, { name: "Qualificação", slug: "whatsapp", type: "system" }),
    ).toBe("Oportunidades");
  });
});

describe("destinosDeSistema", () => {
  it("devolve os três destinos com o nome da org, na ordem dela", () => {
    const configs = [
      cfg("propostas", "Orçamentos", { position: 3 }),
      cfg("whatsapp", "Oportunidades", { position: 1 }),
      cfg("confirmacao", "Agendamentos", { position: 2 }),
    ];
    expect(destinosDeSistema(configs)).toEqual([
      { destination: "qualificacao", pipeType: "whatsapp", label: "Oportunidades" },
      { destination: "confirmacao", pipeType: "confirmacao", label: "Agendamentos" },
      { destination: "propostas", pipeType: "propostas", label: "Orçamentos" },
    ]);
  });

  it("OMITE funil que a org excluiu — linha ausente não é 'existe com o padrão'", () => {
    // A org só tem Oportunidades. Antes desta regra o cadastro oferecia os três
    // e gravava negócio em funil inexistente, sem erro.
    const destinos = destinosDeSistema([cfg("whatsapp", "Oportunidades")]);
    expect(destinos.map((d) => d.destination)).toEqual(["qualificacao"]);
  });

  it("omite funil oculto — esconder da navegação é recusar tráfego novo", () => {
    const configs = [
      cfg("whatsapp", "Oportunidades", { position: 1 }),
      cfg("confirmacao", "Agendamentos", { position: 2, is_visible: false }),
    ];
    expect(destinosDeSistema(configs).map((d) => d.destination)).toEqual([
      "qualificacao",
    ]);
  });

  it("nunca oferece a Carteira — ela é consequência de venda, não destino", () => {
    const configs = [cfg("upsell", "Carteira"), cfg("whatsapp", "Oportunidades")];
    expect(destinosDeSistema(configs).map((d) => d.pipeType)).not.toContain("upsell");
  });

  it("org sem funil de sistema devolve lista vazia, e isso é uma resposta", () => {
    expect(destinosDeSistema([])).toEqual([]);
    expect(destinosDeSistema(undefined)).toEqual([]);
  });
});

describe("guardas mecânicas dos mapas", () => {
  it("NOME_DE_FABRICA está em dia com o SYSTEM_PIPE_CATALOG", () => {
    // O catálogo é a fonte; este arquivo é puro e espelha. Divergir em silêncio
    // faria a org sem linha de display ver um nome que o resto do app não usa.
    for (const cat of SYSTEM_PIPE_CATALOG) {
      expect(NOME_DE_FABRICA[cat.pipe_type]).toBe(cat.display_name);
    }
  });

  it("PIPE_TYPE_PARA_DESTINO é a inversa exata de DEST_TO_PIPE_TYPE", () => {
    // O par assimétrico whatsapp↔qualificacao é o que torna esta guarda útil.
    for (const [destino, pipeType] of Object.entries(DEST_TO_PIPE_TYPE)) {
      expect(PIPE_TYPE_PARA_DESTINO[pipeType]).toBe(destino);
    }
    expect(Object.keys(PIPE_TYPE_PARA_DESTINO)).toHaveLength(
      Object.keys(DEST_TO_PIPE_TYPE).length,
    );
  });
});
