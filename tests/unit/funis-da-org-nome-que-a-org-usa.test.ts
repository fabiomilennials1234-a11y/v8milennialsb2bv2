/**
 * As telas mostram o funil com o nome que a ORG usa — não com o seed.
 *
 * Para funil de sistema, `pipelines.name` é o seed congelado de
 * `create_default_pipelines()`: "Qualificação", "Confirmação", "Propostas".
 * O nome canônico é `pipeline_display_config.display_name`, que é o que a org
 * renomeia e o que a navegação mostra (SCRUM-608).
 *
 * A regra certa já existia (`nomeDoFunil`, em contracts) e três telas a usavam.
 * As outras liam `p.name` cru, e o inbox reescrevia a regra à mão
 * (`cfg?.display_name ?? p.name`). Resultado: rótulo de funil tinha três
 * versões no mesmo produto, e a maioria das telas mostrava o seed.
 *
 * Medido no PROD (2026-09-04): **as 106 orgs têm o trio de sistema**. Ou seja,
 * toda tela com o nome cru mostrava "Qualificação/Confirmação/Propostas" para
 * todas elas — inclusive para quem tinha renomeado os três.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

let pipelines: unknown[] = [];
let displayConfigs: unknown[] = [];
let pipelinesLoading = false;
let configLoading = false;

vi.mock("@/modules/pipelines/hooks/model/usePipelines", () => ({
  usePipelines: () => ({ data: pipelines, isLoading: pipelinesLoading }),
}));
vi.mock("@/modules/pipelines/hooks/config/usePipelineDisplayConfig", () => ({
  usePipelineDisplayConfig: () => ({ data: displayConfigs, isLoading: configLoading }),
}));

import {
  useFunisDaOrg,
  useFunisAtivosDaOrg,
} from "@/modules/pipelines/hooks/model/useFunisDaOrg";

const funil = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  organization_id: "org-1",
  name: "Qualificação",
  slug: "whatsapp",
  type: "system",
  is_active: true,
  display_order: 0,
  ...over,
});

const cfg = (over: Record<string, unknown> = {}) => ({
  pipe_type: "whatsapp",
  display_name: "Oportunidades",
  is_visible: true,
  position: 1,
  ...over,
});

beforeEach(() => {
  pipelines = [];
  displayConfigs = [];
  pipelinesLoading = false;
  configLoading = false;
});

describe("useFunisDaOrg", () => {
  it("usa o display_name da org, não o seed congelado", () => {
    pipelines = [funil()];
    displayConfigs = [cfg()];
    const { result } = renderHook(() => useFunisDaOrg());
    expect(result.current.data[0].label).toBe("Oportunidades");
    // O valor cru continua acessível para quem precisa de chave, log, migration.
    expect(result.current.data[0].name).toBe("Qualificação");
  });

  it("respeita o rename da org — não o padrão de fábrica", () => {
    pipelines = [funil()];
    displayConfigs = [cfg({ display_name: "Entrada de Obra" })];
    const { result } = renderHook(() => useFunisDaOrg());
    expect(result.current.data[0].label).toBe("Entrada de Obra");
  });

  it("funil custom mantém o próprio nome — ali o nome já é o do usuário", () => {
    pipelines = [funil({ id: "p2", name: "Condomínio", slug: "condominio", type: "custom" })];
    displayConfigs = [];
    const { result } = renderHook(() => useFunisDaOrg());
    expect(result.current.data[0].label).toBe("Condomínio");
  });

  it("só devolve o que a org TEM — catálogo não entra por conta própria", () => {
    // A fonte é `pipelines` (recortada por RLS). Uma org com um funil só não
    // pode ver os outros dois do trio aparecerem como opção.
    pipelines = [funil()];
    displayConfigs = [cfg(), cfg({ pipe_type: "propostas", display_name: "Orçamentos" })];
    const { result } = renderHook(() => useFunisDaOrg());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data.map((f) => f.label)).toEqual(["Oportunidades"]);
  });

  it("sem linha de display, cai no nome de fábrica do tipo", () => {
    pipelines = [funil()];
    displayConfigs = [];
    const { result } = renderHook(() => useFunisDaOrg());
    expect(result.current.data[0].label).toBe("Oportunidades");
  });

  it("carrega enquanto o display config não chegou — senão o rótulo trocaria na tela", () => {
    // Sem esperar o config, a tela pintaria "Qualificação" e trocaria para
    // "Oportunidades" no frame seguinte.
    pipelines = [funil()];
    configLoading = true;
    const { result } = renderHook(() => useFunisDaOrg());
    expect(result.current.isLoading).toBe(true);
  });
});

describe("useFunisAtivosDaOrg", () => {
  it("tira o funil desativado — `usePipelines` NÃO filtra is_active", () => {
    pipelines = [
      funil(),
      funil({ id: "p3", name: "Antigo", slug: "antigo", type: "custom", is_active: false }),
    ];
    displayConfigs = [cfg()];
    const { result } = renderHook(() => useFunisAtivosDaOrg());
    expect(result.current.data.map((f) => f.label)).toEqual(["Oportunidades"]);
  });
});
