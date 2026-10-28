/**
 * Um lead pode ter VÁRIOS CNPJ (decisões do CTO: o mesmo documento continua
 * proibido em 2 leads da org; CPF múltiplo NÃO entra; write-back ao Toth leva só
 * o principal; nada em `leads`).
 *
 * Cobre a metade do front: regras puras da lista, hooks, o bloco da ficha, a
 * busca por CNPJ e as guardas de que o CRM não vaza documento extra para o
 * casamento do Toth. A metade do banco é o pgTAP `lead_documents_test.sql`.
 *
 * Documentos: sintéticos, gerados aqui. Nenhum CPF/CNPJ real no repositório.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function cnpj(base12: string): string {
  const digito = (b: string) => {
    let soma = 0;
    for (let i = 0; i < b.length; i++) soma += Number(b[b.length - 1 - i]) * ((i % 8) + 2);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const b13 = base12 + digito(base12);
  return b13 + digito(b13);
}
function cpf(base9: string): string {
  const digito = (b: string, peso: number) => {
    let soma = 0;
    for (let i = 0; i < b.length; i++) soma += Number(b[i]) * (peso - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = digito(base9, 10);
  return base9 + d1 + digito(base9 + d1, 11);
}
const A = cnpj("112223330001");
const B = cnpj("445556660001");
const C = cnpj("998877660001");
const CPF = cpf("135792468");

// ── Banco ───────────────────────────────────────────────────────────────────
const rpc = vi.fn();
const consultas: Array<{ tabela: string; ilike?: string }> = [];
const estado = { falharBusca: false };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (tabela: string) => {
      const reg: { tabela: string; ilike?: string } = { tabela };
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "is", "order", "limit"]) q[k] = () => q;
      q.ilike = (_c: string, padrao: string) => {
        reg.ilike = padrao;
        return q;
      };
      q.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        consultas.push(reg);
        if (estado.falharBusca) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
        return Promise.resolve({ data: [{ lead_id: "lead-9" }, { lead_id: "lead-9" }], error: null }).then(resolve, reject);
      };
      return q;
    },
  },
}));

import {
  adicionarCnpj,
  documentosParaRpc,
  removerDocumento,
  renomearDocumento,
  tornarPrincipal,
  validarDocumentosEditados,
  type LeadDocumentItem,
} from "@/modules/leads/lib/lead-documents";
import {
  buscarLeadIdsPorDocumento,
  mensagemDoErroDeDocumento,
  useSalvarLeadDocuments,
} from "@/modules/leads/hooks/useLeadDocument";
import { LeadCardDocumentos } from "@/modules/leads/components/lead-card/LeadCardDocumentos";
import { aplicarCadastroCafeJurere } from "@/modules/leads/lib/cafe-jurere-cadastro";
import { formatBrDocument } from "@/modules/leads/lib/document";
import type { LeadCardFieldGroup } from "@/modules/leads/components/lead-card/types";

const item = (id: string, document: string, over: Partial<LeadDocumentItem> = {}): LeadDocumentItem => ({
  id,
  document,
  label: null,
  isPrimary: false,
  source: "manual",
  ...over,
});

beforeEach(() => {
  rpc.mockReset();
  consultas.length = 0;
  estado.falharBusca = false;
});

// ── Regras puras ────────────────────────────────────────────────────────────
describe("lib/lead-documents", () => {
  it("lista de CNPJ válidos, um principal: aceita", () => {
    expect(
      validarDocumentosEditados([
        { document: A, label: "Matriz", isPrimary: true },
        { document: B, label: null, isPrimary: false },
      ]),
    ).toBeNull();
  });

  it("CPF com qualquer outro documento é barrado (1 CPF OU vários CNPJ)", () => {
    expect(
      validarDocumentosEditados([
        { document: CPF, label: null, isPrimary: true },
        { document: A, label: null, isPrimary: false },
      ]),
    ).toBe("Um lead com CPF não aceita outros documentos");
    expect(validarDocumentosEditados([{ document: CPF, label: null, isPrimary: true }])).toBeNull();
  });

  it("recusa DV inválido, repetido, dois principais e rótulo gigante", () => {
    const dvErrado = A.slice(0, -1) + String((Number(A.at(-1)) + 1) % 10);
    expect(validarDocumentosEditados([{ document: dvErrado, label: null, isPrimary: false }])).toBe("CPF/CNPJ inválido");
    expect(
      validarDocumentosEditados([
        { document: A, label: null, isPrimary: false },
        { document: formatBrDocument(A)!, label: null, isPrimary: false },
      ]),
    ).toBe("Documento repetido na lista");
    expect(
      validarDocumentosEditados([
        { document: A, label: null, isPrimary: true },
        { document: B, label: null, isPrimary: true },
      ]),
    ).toBe("Só pode haver um documento principal");
    expect(validarDocumentosEditados([{ document: A, label: "x".repeat(121), isPrimary: false }])).toMatch(/Rótulo longo/);
  });

  it("adicionarCnpj: só CNPJ, sem repetir, e nunca com CPF no lead", () => {
    const lista = [item("1", A, { isPrimary: true })];
    const ok = adicionarCnpj(lista, formatBrDocument(B)!, "  Filial Sul ");
    expect(ok).toEqual({
      ok: true,
      lista: [
        { document: A, label: null, isPrimary: true },
        { document: B, label: "Filial Sul", isPrimary: false },
      ],
    });
    expect(adicionarCnpj(lista, CPF, "")).toEqual({ ok: false, erro: "Informe um CNPJ válido" });
    expect(adicionarCnpj(lista, A, "")).toEqual({ ok: false, erro: "Este CNPJ já está na lista" });
    expect(adicionarCnpj([item("1", CPF, { isPrimary: true })], B, "")).toEqual({
      ok: false,
      erro: "Um lead com CPF não aceita outros documentos",
    });
  });

  it("tornarPrincipal troca; remover e renomear mexem só no alvo", () => {
    const lista = [item("1", A, { isPrimary: true, label: "Matriz" }), item("2", B), item("3", C)];
    expect(tornarPrincipal(lista, "2").map((d) => d.isPrimary)).toEqual([false, true, false]);
    expect(removerDocumento(lista, "2").map((d) => d.document)).toEqual([A, C]);
    const r = renomearDocumento(lista, "3", "  Filial  ");
    expect(r.ok && r.lista.map((d) => d.label)).toEqual(["Matriz", null, "Filial"]);
  });

  it("documentosParaRpc manda só dígitos, rótulo limpo e is_primary", () => {
    expect(documentosParaRpc([{ document: formatBrDocument(A)!, label: "  ", isPrimary: true }])).toEqual([
      { document: A, label: null, is_primary: true },
    ]);
  });
});

// ── Mensagens e RPC ─────────────────────────────────────────────────────────
describe("mensagemDoErroDeDocumento — motivos de PT422", () => {
  it("o details diz qual regra; sem details segue 'CPF/CNPJ inválido'", () => {
    expect(mensagemDoErroDeDocumento({ code: "PT422", message: "x", details: "cpf_exclusivo" })).toBe(
      "Um lead com CPF não aceita outros documentos",
    );
    expect(mensagemDoErroDeDocumento({ code: "PT422", message: "x", details: "documento_repetido" })).toBe("Documento repetido na lista");
    expect(mensagemDoErroDeDocumento({ code: "PT422", message: "x", details: "documento_invalido" })).toBe("CPF/CNPJ inválido");
    expect(mensagemDoErroDeDocumento({ code: "PT422", message: "x" })).toBe("CPF/CNPJ inválido");
    expect(mensagemDoErroDeDocumento({ code: "PT409", message: "x" })).toBe("Este documento já está em outro cliente da organização");
  });
});

function comCliente() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

describe("useSalvarLeadDocuments", () => {
  it("chama salvar_documentos_do_lead com a lista completa", async () => {
    rpc.mockResolvedValue({ data: { document: A, erp_document: null, overridden: true, documents: [] }, error: null });
    const { wrapper } = comCliente();
    const { result } = renderHook(() => useSalvarLeadDocuments("lead-1"), { wrapper });
    await act(() =>
      result.current.mutateAsync([
        { document: A, label: "Matriz", isPrimary: true },
        { document: B, label: null, isPrimary: false },
      ]),
    );
    expect(rpc).toHaveBeenCalledWith("salvar_documentos_do_lead", {
      p_lead_id: "lead-1",
      p_docs: [
        { document: A, label: "Matriz", is_primary: true },
        { document: B, label: null, is_primary: false },
      ],
    });
  });

  it("duplicado na org (PT409) vira a frase da ficha", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "Este documento já está em outro cliente da organização.", details: "documento_em_uso" } });
    const { wrapper } = comCliente();
    const { result } = renderHook(() => useSalvarLeadDocuments("lead-1"), { wrapper });
    await expect(result.current.mutateAsync([{ document: A, label: null, isPrimary: false }])).rejects.toThrow(
      "Este documento já está em outro cliente da organização",
    );
  });
});

// ── Busca por CNPJ ──────────────────────────────────────────────────────────
describe("buscarLeadIdsPorDocumento", () => {
  it("consulta lead_documents pelos DÍGITOS (máscara some) e devolve ids únicos", async () => {
    const { client } = comCliente();
    expect(await buscarLeadIdsPorDocumento(client, "org-1", formatBrDocument(A)!)).toEqual(["lead-9"]);
    expect(consultas).toEqual([{ tabela: "lead_documents", ilike: `%${A}%` }]);
  });

  it("termo curto ou sem dígitos não consulta nada", async () => {
    const { client } = comCliente();
    expect(await buscarLeadIdsPorDocumento(client, "org-1", "1234567")).toEqual([]);
    expect(await buscarLeadIdsPorDocumento(client, "org-1", "Maria")).toEqual([]);
    expect(await buscarLeadIdsPorDocumento(client, "org-1", null)).toEqual([]);
    expect(consultas).toEqual([]);
  });

  it("cache por (org, dígitos); outra org é outra consulta; falha degrada para []", async () => {
    const { client } = comCliente();
    await buscarLeadIdsPorDocumento(client, "org-1", A);
    await buscarLeadIdsPorDocumento(client, "org-1", formatBrDocument(A)!);
    expect(consultas).toHaveLength(1);
    await buscarLeadIdsPorDocumento(client, "org-2", A);
    expect(consultas).toHaveLength(2);
    estado.falharBusca = true;
    expect(await buscarLeadIdsPorDocumento(client, "org-3", A)).toEqual([]);
  });
});

// ── O bloco da ficha ────────────────────────────────────────────────────────
describe("LeadCardDocumentos", () => {
  const principal = item("1", A, { isPrimary: true });

  it("lista os extras formatados, com rótulo; o principal fica na linha de cima", () => {
    render(<LeadCardDocumentos documentos={[principal, item("2", B, { label: "Filial Sul" })]} podeEditar onSalvar={vi.fn()} />);
    expect(screen.getByText(formatBrDocument(B)!)).toBeInTheDocument();
    expect(screen.getByText("Filial Sul")).toBeInTheDocument();
    expect(screen.queryByText(formatBrDocument(A)!)).toBeNull();
  });

  it("adicionar CNPJ manda a lista completa com o novo como extra", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(<LeadCardDocumentos documentos={[principal]} podeEditar onSalvar={onSalvar} />);
    fireEvent.click(screen.getByText("Adicionar CNPJ"));
    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: B } });
    expect((screen.getByLabelText("CNPJ") as HTMLInputElement).value).toBe(formatBrDocument(B));
    fireEvent.change(screen.getByLabelText("Rótulo do CNPJ"), { target: { value: "Filial" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledTimes(1));
    expect(onSalvar).toHaveBeenCalledWith([
      { document: A, label: null, isPrimary: true },
      { document: B, label: "Filial", isPrimary: false },
    ]);
  });

  it("CPF no campo ou DV errado não chega ao banco e a mensagem aparece", async () => {
    const onSalvar = vi.fn();
    render(<LeadCardDocumentos documentos={[principal]} podeEditar onSalvar={onSalvar} />);
    fireEvent.click(screen.getByText("Adicionar CNPJ"));
    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: CPF } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Informe um CNPJ válido");
    expect(onSalvar).not.toHaveBeenCalled();
  });

  it("recusa do banco (duplicado na org) fica na tela e o formulário não fecha", async () => {
    const onSalvar = vi.fn().mockRejectedValue(new Error("Este documento já está em outro cliente da organização"));
    render(<LeadCardDocumentos documentos={[principal]} podeEditar onSalvar={onSalvar} />);
    fireEvent.click(screen.getByText("Adicionar CNPJ"));
    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: B } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este documento já está em outro cliente da organização");
    expect(screen.getByLabelText("CNPJ")).toBeInTheDocument();
  });

  it("tornar principal e remover mandam a lista nova", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(<LeadCardDocumentos documentos={[principal, item("2", B), item("3", C)]} podeEditar onSalvar={onSalvar} />);
    fireEvent.click(screen.getByLabelText(`Tornar principal o CNPJ ${formatBrDocument(B)}`));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledTimes(1));
    expect(onSalvar.mock.calls[0][0].map((d: { isPrimary: boolean }) => d.isPrimary)).toEqual([false, true, false]);
    fireEvent.click(screen.getByLabelText(`Remover o CNPJ ${formatBrDocument(C)}`));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledTimes(2));
    expect(onSalvar.mock.calls[1][0].map((d: { document: string }) => d.document)).toEqual([A, B]);
  });

  it("extras SEM principal (nada é promovido sozinho): todos listados e 'tornar principal' escolhe um", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(<LeadCardDocumentos documentos={[item("2", B), item("3", C)]} podeEditar onSalvar={onSalvar} />);
    expect(screen.getByText(formatBrDocument(B)!)).toBeInTheDocument();
    expect(screen.getByText(formatBrDocument(C)!)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(`Tornar principal o CNPJ ${formatBrDocument(C)}`));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledTimes(1));
    expect(onSalvar.mock.calls[0][0]).toEqual([
      { document: B, label: null, isPrimary: false },
      { document: C, label: null, isPrimary: true },
    ]);
  });

  it("adicionar CNPJ a lead sem principal manda o novo como extra, sem marcar principal", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(<LeadCardDocumentos documentos={[item("2", B)]} podeEditar onSalvar={onSalvar} />);
    fireEvent.click(screen.getByText("Adicionar CNPJ"));
    fireEvent.change(screen.getByLabelText("CNPJ"), { target: { value: C } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledTimes(1));
    expect(onSalvar.mock.calls[0][0].some((d: { isPrimary: boolean }) => d.isPrimary)).toBe(false);
  });

  it("sem permissão: lista visível, nenhuma ação", () => {
    render(<LeadCardDocumentos documentos={[principal, item("2", B)]} podeEditar={false} onSalvar={vi.fn()} />);
    expect(screen.getByText(formatBrDocument(B)!)).toBeInTheDocument();
    expect(screen.queryByText("Adicionar CNPJ")).toBeNull();
    expect(screen.queryByLabelText(/Remover o CNPJ/)).toBeNull();
  });

  it("lead com CPF não oferece adicionar", () => {
    const { container } = render(<LeadCardDocumentos documentos={[item("1", CPF, { isPrimary: true })]} podeEditar onSalvar={vi.fn()} />);
    expect(screen.queryByText("Adicionar CNPJ")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});

// ── Café Jurerê: o override principal continua vencendo o ERP ───────────────
describe("aplicarCadastroCafeJurere — vários CNPJ", () => {
  const grupos: LeadCardFieldGroup[] = [
    {
      titulo: "Perfil",
      campos: [{ chave: "documento", rotulo: "CPF / CNPJ", valor: null, tipo: "documento", documentos: [item("2", B)] }],
    },
  ];

  it("o principal do Torque vence o ERP; os extras seguem na lista e não viram valor", () => {
    const doc = aplicarCadastroCafeJurere(grupos, { cnpj: C, erp_metadata: {} }, A)[0].campos[0];
    expect(doc).toMatchObject({ valor: A, alteradoLocalmente: true, valorErp: C });
    expect(doc.documentos).toEqual([item("2", B)]);
  });

  it("sem principal vale o ERP, nunca um extra", () => {
    const doc = aplicarCadastroCafeJurere(grupos, { cnpj: C, erp_metadata: {} }, null)[0].campos[0];
    expect(doc).toMatchObject({ valor: C, origemErp: true, alteradoLocalmente: false });
  });
});

// ── Decisão (c): extras nunca entram em casamento do Toth ───────────────────
function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivosTs(caminho);
    return caminho.endsWith(".ts") && !caminho.endsWith(".test.ts") ? [caminho] : [];
  });
}

describe("o CRM não vaza documento extra para o ERP", () => {
  const rotas = ["supabase/functions/_shared/erp"];
  for (const f of readdirSync("supabase/functions")) {
    if (/^(toth|erp-order|tinyerp)/.test(f)) rotas.push(join("supabase/functions", f));
  }

  it("nenhum código de sync/casamento do ERP lê ou escreve lead_documents", () => {
    const culpados = rotas
      .flatMap(arquivosTs)
      .filter((arq) => /lead_documents|lead_document_events|salvar_documentos_do_lead|set_lead_document/.test(readFileSync(arq, "utf8")));
    expect(culpados).toEqual([]);
  });

  it("o casamento do Toth continua por upsell_clients.cnpj (a única chave)", () => {
    const store = readFileSync("supabase/functions/_shared/erp/sync/order-store.ts", "utf8");
    expect(store).toMatch(/upsell_clients/);
    expect(store).toMatch(/cnpj/);
  });
});

// ── A migration não toca `leads` ────────────────────────────────────────────
describe("migration 20271217000000", () => {
  const sql = readFileSync("supabase/migrations/20271217000000_lead_documents_multiplos_cnpj.sql", "utf8");
  const codigo = sql.replace(/--.*$/gm, "");

  it("decisão (d): nenhuma coluna nem DML em public.leads", () => {
    expect(codigo).not.toMatch(/ALTER TABLE\s+(public\.)?leads\b/i);
    expect(codigo).not.toMatch(/UPDATE\s+(public\.)?leads\b/i);
    expect(codigo).not.toMatch(/(INSERT INTO|DELETE FROM)\s+(public\.)?leads\b/i);
  });

  it("sem promoção automática: nenhuma atribuição de principal fora do que foi escolhido", () => {
    expect(codigo).not.toMatch(/v_new_primary\s*:=\s*v_docs\[1\]/);
    expect(codigo).not.toMatch(/ORDER BY d\.created_at, d\.id LIMIT 1/);
  });

  it("unique_violation: só lead_documents_org_document_uq vira PT409; o resto re-levanta", () => {
    expect(codigo.match(/GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME/g)).toHaveLength(2);
    expect(codigo.match(/IF v_c = 'lead_documents_org_document_uq' THEN/g)).toHaveLength(2);
  });

  it("RLS de leitura: policies antigas removidas; lead visível + apagados só para admin da org", () => {
    expect(codigo).toMatch(/DROP POLICY IF EXISTS lead_documents_select_org/);
    expect(codigo).toMatch(/DROP POLICY IF EXISTS lead_document_events_select_org/);
    expect(codigo).toMatch(/EXISTS \(SELECT 1 FROM public\.leads l WHERE l\.id = lead_documents\.lead_id\)/);
    expect(codigo).toMatch(/deleted_at IS NULL OR public\.is_org_admin\(organization_id\)/);
  });

  it("RPC nova: sem EXECUTE para PUBLIC/anon, GRANT só authenticated", () => {
    expect(codigo).toMatch(/REVOKE ALL ON FUNCTION public\.salvar_documentos_do_lead\(uuid, jsonb\) FROM PUBLIC, anon;/);
    expect(codigo).toMatch(/GRANT EXECUTE ON FUNCTION public\.salvar_documentos_do_lead\(uuid, jsonb\) TO authenticated;/);
    expect(codigo).not.toMatch(/GRANT EXECUTE[^;]*\bTO\b[^;]*\banon\b/i);
  });

  it("toda função SECURITY DEFINER fixa o search_path", () => {
    const funcoes = codigo.split(/CREATE OR REPLACE FUNCTION/).slice(1);
    expect(funcoes.length).toBeGreaterThan(5);
    for (const f of funcoes) {
      const cabeca = f.slice(0, f.indexOf("$fn$"));
      if (/SECURITY DEFINER/.test(cabeca)) expect(cabeca).toMatch(/SET search_path = public/);
    }
  });
});
