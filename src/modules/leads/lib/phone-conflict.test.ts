/**
 * Contrato da tradução do "duplicate key" de telefone.
 *
 * Três invariantes que este módulo tem que segurar, e que foram exatamente os
 * defeitos relatados pela Gráfica Cauta:
 *   1. a chave da pré-checagem é a MESMA do índice único (`normalized_phone`);
 *   2. lead que a RLS esconde bloqueia, mas não vaza nome/empresa/responsável;
 *   3. lookup indisponível nunca inventa um bloqueio que o banco não tem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  checkPhoneBeforeCreate,
  phoneConflictMessage,
  isPhoneUniqueViolation,
} from "./phone-conflict";

/** Builder encadeável e aguardável, no formato do postgrest-js. */
function chain(result: unknown, calls: unknown[][] = []) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "is"]) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(result);
  b.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, err);
  return b;
}

const ORG = "org-1";
let leadsResult: unknown;
let memberResult: unknown;
let leadsCalls: unknown[][];

beforeEach(() => {
  leadsCalls = [];
  leadsResult = { data: [], error: null };
  memberResult = { data: null, error: null };
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [{ taken: false, in_trash: false }], error: null });
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) =>
    table === "leads" ? chain(leadsResult, leadsCalls) : chain(memberResult)
  );
});

describe("checkPhoneBeforeCreate", () => {
  it("consulta pela mesma chave que o índice único usa", async () => {
    await checkPhoneBeforeCreate(ORG, "(19) 3527-0422");

    // `normalized_phone` é o que o índice único indexa. O fixo (19) 3527-0422
    // é gravado como 19935270422 porque normalize_brazilian_phone insere um "9"
    // em todo número de 10 dígitos — é a causa do falso positivo, e a
    // pré-checagem tem que enxergar o mundo do MESMO jeito que o banco, senão
    // avisa do que o banco aceita ou silencia o que ele recusa.
    expect(leadsCalls).toContainEqual(["eq", "normalized_phone", "19935270422"]);
  });

  it("bloqueia nomeando o lead quando o usuário pode vê-lo", async () => {
    leadsResult = {
      data: [{ id: "l1", name: "Padaria Cauta", company: "Cauta ME", deleted_at: null, responsible_id: "tm1" }],
      error: null,
    };
    memberResult = { data: { name: "Ana" }, error: null };

    const gate = await checkPhoneBeforeCreate(ORG, "(19) 3527-0422");

    expect(gate?.kind).toBe("block");
    expect(gate?.message).toContain("Padaria Cauta");
    expect(gate?.message).toContain("Cauta ME");
    expect(gate?.message).toContain("Ana");
    // Enxergou pela RLS: não precisa perguntar nada ao SECURITY DEFINER.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("bloqueia SEM vazar nada quando a RLS esconde o lead do usuário", async () => {
    leadsResult = { data: [], error: null };
    rpcMock.mockResolvedValue({ data: [{ taken: true, in_trash: false }], error: null });

    const gate = await checkPhoneBeforeCreate(ORG, "19998887766");

    expect(gate?.kind).toBe("block");
    expect(gate?.message).toContain("não aparece para você");
    // O vendedor apanha do bloqueio, mas não descobre a carteira do colega.
    expect(gate?.message).not.toMatch(/responsável|empresa:/i);
  });

  it("lead na lixeira vira confirmação, não bloqueio — e avisa do custo", async () => {
    leadsResult = {
      data: [{ id: "l9", name: "Antigo", company: null, deleted_at: "2026-01-05T00:00:00Z", responsible_id: null }],
      error: null,
    };

    const gate = await checkPhoneBeforeCreate(ORG, "19998887766");

    // A lixeira não ocupa o índice único (ele filtra deleted_at IS NULL), então
    // criar é permitido — mas restaurar o antigo depois deixa de ser.
    expect(gate?.kind).toBe("confirm");
    expect(gate?.message).toContain("LIXEIRA");
    expect(gate?.message).toContain("não poderá ser restaurado");
  });

  it("sem conflito, não atrapalha", async () => {
    expect(await checkPhoneBeforeCreate(ORG, "19998887766")).toBeNull();
  });

  it("telefone vazio não consulta nada", async () => {
    expect(await checkPhoneBeforeCreate(ORG, "")).toBeNull();
    expect(await checkPhoneBeforeCreate(ORG, null)).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("lookup indisponível não inventa bloqueio", async () => {
    // Cenário real: front no ar antes da migration. A RPC não existe (PGRST202).
    // O índice único do banco continua sendo a garantia — travar o cadastro aqui
    // seria inventar um impedimento que o banco não tem.
    leadsResult = { data: [], error: null };
    rpcMock.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });

    expect(await checkPhoneBeforeCreate(ORG, "19998887766")).toBeNull();
  });
});

describe("isPhoneUniqueViolation", () => {
  it("reconhece só a violação do índice de telefone", () => {
    expect(isPhoneUniqueViolation({ code: "23505", message: 'unique constraint "idx_leads_org_phone_unique"' })).toBe(true);
    expect(isPhoneUniqueViolation({ code: "23505", message: 'unique constraint "idx_leads_org_email"' })).toBe(false);
    expect(isPhoneUniqueViolation({ code: "23503", message: "foreign key" })).toBe(false);
    expect(isPhoneUniqueViolation(null)).toBe(false);
  });
});

describe("phoneConflictMessage", () => {
  it("devolve null para erro que não é de telefone duplicado", async () => {
    expect(await phoneConflictMessage({ code: "42501" }, ORG, "19998887766")).toBeNull();
  });

  it("nomeia o lead quando consegue identificá-lo", async () => {
    leadsResult = {
      data: [{ id: "l1", name: "Padaria Cauta", company: null, deleted_at: null, responsible_id: null }],
      error: null,
    };

    const msg = await phoneConflictMessage(
      { code: "23505", message: 'duplicate key value violates unique constraint "idx_leads_org_phone_unique"' },
      ORG,
      "(19) 3527-0422"
    );

    expect(msg).toContain("Padaria Cauta");
  });

  it("cai numa mensagem genérica — mas nunca no erro cru do Postgres", async () => {
    leadsResult = { data: [], error: null };

    const msg = await phoneConflictMessage(
      { code: "23505", message: 'duplicate key value violates unique constraint "idx_leads_org_phone_unique"' },
      ORG,
      "19998887766"
    );

    expect(msg).toContain("já está cadastrado");
    expect(msg).not.toContain("duplicate key");
  });
});
