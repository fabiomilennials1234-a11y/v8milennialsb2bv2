import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  documentosParaRpc,
  leadDocumentFromRow,
  ordenarDocumentos,
  type DocumentoEditado,
  type LeadDocumentRow,
} from "../lib/lead-documents";

/**
 * CPF/CNPJ do lead editados no Torque (Chamado 93027ffb; vários CNPJ).
 *
 * Os documentos moram em `lead_documents` (1 CPF OU vários CNPJ, um principal
 * opcional) e só são escritos pelas RPCs `salvar_documentos_do_lead` (lista
 * completa) e `set_lead_document` (só o principal). `upsell_clients.cnpj`
 * continua espelho do ERP e única chave de casamento com o Toth: os extras NUNCA
 * entram em casamento. Sem linha principal vale o documento do ERP.
 */
export const leadDocumentKey = (leadId: string | null) => ["lead-document", leadId] as const;

export interface LeadDocumentOverride {
  document: string;
  erpDocumentAtSet: string | null;
  erpWritebackStatus: string;
  updatedAt: string;
}

interface LeadDocumentRowCompleta extends LeadDocumentRow {
  erp_document_at_set: string | null;
  erp_writeback_status: string;
  updated_at: string;
}

const SELECT_DOCUMENTOS =
  "id,document,label,is_primary,source,erp_document_at_set,erp_writeback_status,updated_at";

/** Documentos ativos do lead (principal primeiro). Uma consulta serve a lista e o principal. */
function useDocumentosDoLeadQuery(leadId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: leadDocumentKey(leadId),
    enabled: enabled && !!leadId,
    staleTime: 60_000,
    queryFn: async (): Promise<LeadDocumentRowCompleta[]> => {
      const { data, error } = await supabase
        .from("lead_documents")
        .select(SELECT_DOCUMENTOS)
        .eq("lead_id", leadId!)
        .is("deleted_at", null)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LeadDocumentRowCompleta[];
    },
  });
}

/** Raiz das entradas de cache da busca por documento — invalidada quando documento muda. */
const BUSCA_DOCUMENTO_ROOT = ["lead-documents-busca"] as const;

/**
 * Abaixo disso ("1234") o `ilike` casaria com documento de meia base e a busca
 * por telefone/nome viraria ruído. 8 dígitos é a raiz do CNPJ.
 */
const MIN_DIGITOS_BUSCA_DOCUMENTO = 8;
/** Teto de leads trazidos pelo documento — a busca é por um CNPJ. */
const TETO_BUSCA_DOCUMENTO = 200;
const BUSCA_DOCUMENTO_STALE_MS = 60_000;

/**
 * Pré-consulta da busca da lista de Leads: ids dos leads cujo CPF/CNPJ ATIVO
 * (principal ou extra, `lead_documents`) contém os dígitos digitados. O
 * `upsell_clients.cnpj` do ERP não entra aqui (a lista não o busca hoje).
 *
 * Só os DÍGITOS entram na consulta (máscara "12.345.678/0001-95" é descartada),
 * o que também os torna seguros de interpolar no `ilike`. Mesmo desenho da
 * busca por telefone secundário: passa pelo cache, falha degrada para "sem
 * achados" e a busca por nome/telefone segue funcionando.
 */
export async function buscarLeadIdsPorDocumento(
  queryClient: QueryClient,
  organizationId: string,
  search: string | null | undefined,
): Promise<string[]> {
  const digits = (search ?? "").replace(/\D/g, "");
  if (digits.length < MIN_DIGITOS_BUSCA_DOCUMENTO) return [];
  try {
    return await queryClient.fetchQuery({
      queryKey: [...BUSCA_DOCUMENTO_ROOT, organizationId, digits],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("lead_documents")
          .select("lead_id")
          .eq("organization_id", organizationId)
          .is("deleted_at", null)
          .ilike("document", `%${digits}%`)
          .limit(TETO_BUSCA_DOCUMENTO);
        if (error) throw error;
        return [...new Set(((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id))];
      },
      staleTime: BUSCA_DOCUMENTO_STALE_MS,
      retry: false,
    });
  } catch {
    return [];
  }
}

/** Lista de documentos do lead, principal primeiro. */
export function useLeadDocuments(leadId: string | null, enabled: boolean) {
  const query = useDocumentosDoLeadQuery(leadId, enabled);
  // Referência estável: a ficha usa a lista como dependência de useMemo.
  const data = useMemo(
    () => (query.data ? ordenarDocumentos(query.data.map(leadDocumentFromRow)) : undefined),
    [query.data],
  );
  return { ...query, data };
}

/** Compat: o override PRINCIPAL (ou `null` quando vale o do ERP). */
export function useLeadDocument(leadId: string | null, enabled: boolean) {
  const query = useDocumentosDoLeadQuery(leadId, enabled);
  const data = useMemo((): LeadDocumentOverride | null | undefined => {
    if (!query.data) return undefined;
    const principal = query.data.find((d) => d.is_primary);
    return principal
      ? {
          document: principal.document,
          erpDocumentAtSet: principal.erp_document_at_set,
          erpWritebackStatus: principal.erp_writeback_status,
          updatedAt: principal.updated_at,
        }
      : null;
  }, [query.data]);
  return { ...query, data };
}

/**
 * Recusas que a RPC devolve com SQLSTATE próprio (o PostgREST repassa como
 * `code`). A mensagem do banco já é pt-BR; o mapa garante o texto mesmo que
 * ela mude, e nunca expõe o outro lead que já usa o documento.
 */
const RECUSAS: Record<string, string> = {
  PT422: "CPF/CNPJ inválido",
  PT409: "Este documento já está em outro cliente da organização",
  PT404: "Lead não encontrado. Atualize a ficha.",
  "42501": "Sem permissão para alterar o documento",
};

/** PT422 tem mais de um motivo; o `details` (DETAIL da RPC) diz qual. */
const RECUSAS_POR_MOTIVO: Record<string, string> = {
  cpf_exclusivo: "Um lead com CPF não aceita outros documentos",
  documento_repetido: "Documento repetido na lista",
  principal_duplicado: "Só pode haver um documento principal",
  rotulo_invalido: "Rótulo longo demais (máximo 120 caracteres)",
  limite_de_documentos: "Limite de 50 documentos por lead",
  documentos_invalidos: "Lista de documentos inválida",
};

export function mensagemDoErroDeDocumento(
  error: { code?: string; message?: string; details?: string | null } | null | undefined,
): string {
  if (error?.code === "PT422" && error.details && RECUSAS_POR_MOTIVO[error.details]) {
    return RECUSAS_POR_MOTIVO[error.details];
  }
  if (error?.code && RECUSAS[error.code]) {
    // 42501 cobre "sem permissão" e "não edita este lead": a frase do banco diz qual.
    return error.code === "42501" && error.message ? error.message.replace(/\.$/, "") : RECUSAS[error.code];
  }
  return "Não foi possível salvar o documento";
}

export interface SetLeadDocumentResult {
  document: string | null;
  erp_document: string | null;
  overridden: boolean;
  erp_writeback_status: string | null;
}

export function useSetLeadDocument(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (document: string): Promise<SetLeadDocumentResult> => {
      if (!leadId) throw new Error("Lead não encontrado. Atualize a ficha.");
      // Chamado NO objeto: `const rpc = supabase.rpc` perde o receiver.
      const { data, error } = await supabase.rpc("set_lead_document", {
        p_lead_id: leadId,
        p_document: document,
      });
      if (error) throw new Error(mensagemDoErroDeDocumento(error));
      return data as unknown as SetLeadDocumentResult;
    },
    onSettled: () => invalidarDocumentos(qc, leadId),
  });
}

function invalidarDocumentos(qc: QueryClient, leadId: string | null) {
  return Promise.all([
    // Documento que entrou/saiu muda quem a busca por CNPJ acha.
    qc.invalidateQueries({ queryKey: BUSCA_DOCUMENTO_ROOT }),
    qc.invalidateQueries({ queryKey: leadDocumentKey(leadId) }),
    // A chave do cadastro ERP leva a org de quem olha (`useOrganization`),
    // que para master é nula; casar pelo lead cobre os dois casos.
    qc.invalidateQueries({ queryKey: ["cafe-jurere-cadastro"], predicate: (q) => q.queryKey[2] === leadId }),
  ]);
}

export interface SalvarLeadDocumentsResult {
  document: string | null;
  erp_document: string | null;
  overridden: boolean;
  documents: Array<{ id: string; document: string; label: string | null; is_primary: boolean; source: string }>;
}

/** Grava a LISTA COMPLETA de documentos do lead (a RPC apaga o que saiu dela). */
export function useSalvarLeadDocuments(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (lista: DocumentoEditado[]): Promise<SalvarLeadDocumentsResult> => {
      if (!leadId) throw new Error("Lead não encontrado. Atualize a ficha.");
      // Chamado NO objeto: `const rpc = supabase.rpc` perde o receiver.
      const { data, error } = await supabase.rpc("salvar_documentos_do_lead", {
        p_lead_id: leadId,
        p_docs: documentosParaRpc(lista),
      });
      if (error) throw new Error(mensagemDoErroDeDocumento(error));
      return data as unknown as SalvarLeadDocumentsResult;
    },
    onSettled: () => invalidarDocumentos(qc, leadId),
  });
}
