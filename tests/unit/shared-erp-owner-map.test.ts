/**
 * De-para de representante do ERP → responsável no Torque.
 *
 * O que estes testes protegem é uma distinção de três estados que, se colapsar
 * em dois, redistribui carteira sozinha:
 *
 *   - **sem linha no mapa** → `undefined` → o chamador NÃO toca `responsible_id`
 *   - **linha com team member** → o uuid → atribui
 *   - **linha com `null`** → `null` → tira o dono DE PROPÓSITO (é assim que um
 *     canal como `TORREFAÇÃO` é registrado)
 *
 * Colapsar os dois primeiros faria mapa vazio limpar o dono de 12 mil clientes.
 * E dono de lead é o que a regra de visibilidade do Torque lê: o erro não
 * apareceria como exceção, apareceria como vendedor que perdeu a carteira.
 */
import { describe, it, expect } from "vitest";
import {
  resolveResponsible,
  type OwnerMap,
} from "../../supabase/functions/_shared/erp/sync/owner-map";
import { clientEnrichmentColumns } from "../../supabase/functions/_shared/erp/sync/client-enrichment";
import type { CanonicalClient } from "../../supabase/functions/_shared/erp/types";

const TM = "11111111-1111-1111-1111-111111111111";

/** Códigos reais da Café Jurerê: 8953 é ISABELLE, 9510 é o canal TORREFACAO. */
const MAPA: OwnerMap = new Map([
  ["8953", TM],
  ["9510", null],
]);

describe("resolveResponsible", () => {
  it("código mapeado devolve o team member", () => {
    expect(resolveResponsible(MAPA, "8953")).toBe(TM);
  });

  it("código mapeado para NULL devolve null — canal sem dono é decisão", () => {
    expect(resolveResponsible(MAPA, "9510")).toBeNull();
  });

  it("código NÃO mapeado devolve undefined — silêncio não é palpite", () => {
    expect(resolveResponsible(MAPA, "13640")).toBeUndefined();
  });

  it("mapa vazio devolve undefined para qualquer código", () => {
    expect(resolveResponsible(new Map(), "8953")).toBeUndefined();
    expect(resolveResponsible(undefined, "8953")).toBeUndefined();
  });

  it("cliente sem representante devolve undefined", () => {
    expect(resolveResponsible(MAPA, null)).toBeUndefined();
    expect(resolveResponsible(MAPA, undefined)).toBeUndefined();
    expect(resolveResponsible(MAPA, "   ")).toBeUndefined();
  });

  it("apara espaço — código de ERP vem com sujeira de cadastro", () => {
    expect(resolveResponsible(MAPA, " 8953 ")).toBe(TM);
  });

  it("o código é comparado como TEXTO, não como número", () => {
    // `0126` e `126` são códigos distintos num cadastro que aceita zero à
    // esquerda. Normalizar para número casaria os dois no vendedor errado.
    expect(resolveResponsible(new Map([["0126", TM]]), "126")).toBeUndefined();
  });
});

describe("clientEnrichmentColumns — a ponte com a escrita", () => {
  const cliente = (ownerExternalId: string | null): CanonicalClient =>
    ({
      externalId: "1",
      name: "Cliente",
      ownerExternalId,
      ownerName: "QUALQUER",
    }) as unknown as CanonicalClient;

  it("SEM mapa, `responsible_id` nem aparece no objeto de escrita", () => {
    const cols = clientEnrichmentColumns(cliente("8953"));
    expect("responsible_id" in cols).toBe(false);
  });

  it("com mapa e código conhecido, escreve o team member", () => {
    const cols = clientEnrichmentColumns(cliente("8953"), MAPA);
    expect(cols.responsible_id).toBe(TM);
  });

  it("com mapa e código de canal, escreve null (limpa de propósito)", () => {
    const cols = clientEnrichmentColumns(cliente("9510"), MAPA);
    expect("responsible_id" in cols).toBe(true);
    expect(cols.responsible_id).toBeNull();
  });

  /**
   * O caso que mais importa: com o mapa parcialmente preenchido — que é o
   * estado real enquanto alguém mapeia 216 representantes aos poucos —, o
   * cliente de um representante ainda não decidido tem que sair intocado.
   */
  it("com mapa parcial, representante não decidido sai INTOCADO", () => {
    const cols = clientEnrichmentColumns(cliente("13640"), MAPA);
    expect("responsible_id" in cols).toBe(false);
  });

  it("não atropela os campos de enriquecimento que já existiam", () => {
    const cols = clientEnrichmentColumns(cliente("8953"), MAPA);
    expect(cols.erp_owner_external_id).toBe("8953");
    expect(cols.erp_owner_name).toBe("QUALQUER");
  });
});
