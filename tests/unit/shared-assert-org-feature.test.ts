/**
 * Tests for _shared/assert-org-feature.ts — backstop de gating por plano.
 *
 * Regressão de 2026-07-22: a RPC `org_has_feature` não existia em prod (a
 * migration que a criava nunca rodou — colisão de prefixo de versão), então o
 * PostgREST devolvia 404/PGRST202. `assertOrgFeature` repassava o PostgrestError
 * cru com `throw error`; como PostgrestError é um objeto plano e não uma
 * instância de Error, todo `err instanceof Error ? err.message : "Erro interno"`
 * rio abaixo caía no literal genérico. `cadastro-externo-push` falhou 100% das
 * vezes por 9 dias reportando apenas "Erro interno".
 *
 * Um fake do client cobre a lógica sem banco.
 */
import { describe, it, expect } from "vitest";
import {
  assertOrgFeature,
  FeatureLockedError,
} from "../../supabase/functions/_shared/assert-org-feature";

const ORG = "6030520a-2ca7-477d-be89-55758e2cd808";

type RpcResult = { data: unknown; error: unknown };

function makeAdmin(result: RpcResult) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return result;
    },
  };
  // O tipo real é SupabaseClient; o fake só precisa do método rpc.
  return { admin: admin as never, calls };
}

describe("assertOrgFeature", () => {
  it("passa quando a org tem a feature", async () => {
    const { admin } = makeAdmin({ data: true, error: null });
    await expect(
      assertOrgFeature(admin, ORG, "external_cadastro"),
    ).resolves.toBeUndefined();
  });

  it("chama a RPC org_has_feature com os nomes de parâmetro do contrato", async () => {
    // Guarda o contrato contra a migration: org_has_feature(p_org_id, p_feature_key).
    // Um rename de qualquer um dos lados vira PGRST202 em runtime, não erro de build.
    const { admin, calls } = makeAdmin({ data: true, error: null });
    await assertOrgFeature(admin, ORG, "external_cadastro");

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("org_has_feature");
    expect(calls[0].args).toEqual({
      p_org_id: ORG,
      p_feature_key: "external_cadastro",
    });
  });

  it("lança FeatureLockedError quando a feature está bloqueada", async () => {
    const { admin } = makeAdmin({ data: false, error: null });
    await expect(
      assertOrgFeature(admin, ORG, "external_cadastro"),
    ).rejects.toBeInstanceOf(FeatureLockedError);
  });

  it("converte erro de RPC em Error preservando a mensagem real", async () => {
    // O caso exato da regressão: PostgrestError é objeto plano, não Error.
    const postgrestError = {
      code: "PGRST202",
      message:
        "Could not find the function public.org_has_feature(p_feature_key, p_org_id) in the schema cache",
      details: null,
      hint: "Perhaps you meant to call the function public.has_feature",
    };
    const { admin } = makeAdmin({ data: null, error: postgrestError });

    const err = await assertOrgFeature(admin, ORG, "external_cadastro").catch(
      (e) => e,
    );

    // Sem isto, o catch da edge fn degrada para "Erro interno" e o operador fica cego.
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("PGRST202");
    expect(err.message).toContain("org_has_feature");
  });

  it("não confunde falha de RPC com feature bloqueada", async () => {
    // Uma indisponibilidade de infra não pode ser lida como "org sem direito":
    // isso mascararia o incidente como decisão de produto.
    const { admin } = makeAdmin({
      data: null,
      error: { code: "57014", message: "canceling statement due to timeout" },
    });

    const err = await assertOrgFeature(admin, ORG, "external_cadastro").catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(FeatureLockedError);
  });
});
