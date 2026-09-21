import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { parseTothOrderWorkspace, type TothOrderDraftInput, type TothOrderWorkspace } from "../lib/toth-order-domain";

export interface TothOrderPreparer {
  team_member_id: string;
  name: string;
  can_prepare: boolean;
}

type RpcError = { code?: string; message?: string };
type RpcContracts = {
  toth_order_workspace: { args: { p_deal_id: string }; result: TothOrderWorkspace };
  toth_save_order_draft: {
    args: { p_deal_id: string; p_expected_revision: number; p_items: TothOrderDraftInput["items"]; p_notes: string };
    result: TothOrderWorkspace;
  };
  toth_review_order_draft: {
    args: { p_deal_id: string; p_expected_revision: number };
    result: TothOrderWorkspace;
  };
  toth_order_preparer_access: { args: { p_deal_id: string }; result: TothOrderPreparer[] };
  toth_set_order_preparer: {
    args: { p_deal_id: string; p_team_member_id: string; p_enabled: boolean };
    result: TothOrderPreparer[];
  };
};

// Compatibility bridge until the migration is deployed and types regenerated.
// Deliberately exposes only local draft RPCs: no ERP dispatch function.
const draftClient = supabase as unknown as {
  rpc<K extends keyof RpcContracts>(name: K, args: RpcContracts[K]["args"]): PromiseLike<{
    data: unknown;
    error: RpcError | null;
  }>;
};

export class TothOrderDraftError extends Error {
  constructor(message: string, readonly kind: "conflict" | "unavailable" | "access_denied" | "failure" = "failure") {
    super(message);
    this.name = "TothOrderDraftError";
  }
}

function translateError(error: RpcError): TothOrderDraftError {
  if (["42501", "PGRST301", "PGRST302"].includes(error.code ?? "") || error.message?.includes("toth_access_denied")) {
    return new TothOrderDraftError("Você não tem permissão para realizar esta ação.", "access_denied");
  }
  if (error.code === "PGRST202" || error.code === "42883") {
    return new TothOrderDraftError("A preparação de pedidos ainda não está disponível neste ambiente.", "unavailable");
  }
  if (error.code === "40001" || error.message?.includes("toth_revision_conflict")) {
    return new TothOrderDraftError(
      "O rascunho ou o vínculo do cliente mudou. Suas alterações locais foram preservadas. Carregue a versão atual antes de continuar.",
      "conflict",
    );
  }
  const messages: Record<string, string> = {
    toth_access_denied: "Você não tem permissão para realizar esta ação.",
    toth_drafts_disabled: "A preparação de pedidos está desativada para esta organização.",
    toth_deal_unavailable: "Este negócio não está disponível para preparar um pedido.",
    toth_client_link_unavailable: "É necessário um vínculo válido e único com um cliente do Toth.",
    toth_invalid_items: "Confira os produtos e as quantidades do rascunho.",
    toth_catalog_item_unavailable: "Um produto não está mais disponível no catálogo. Atualize e revise o rascunho.",
    toth_invalid_notes: "As observações devem ter no máximo 1.000 caracteres.",
    toth_review_requires_items: "Adicione pelo menos um produto do catálogo antes de revisar.",
    toth_draft_unavailable: "Salve o rascunho antes de registrar a revisão.",
    toth_invalid_preparer: "Este usuário não está disponível para receber a permissão.",
    toth_write_contract_unverified: "O envio aguarda a validação do contrato de escrita com a Toth.",
    toth_local_projection_unavailable: "Não foi possível validar o registro deste pedido na Carteira. Solicite a conferência de um administrador.",
  };
  const key = Object.keys(messages).find((name) => error.message?.includes(name));
  return new TothOrderDraftError(key ? messages[key] : "Não foi possível concluir a ação. Tente novamente.");
}

const preparersSchema = z.array(z.object({
  team_member_id: z.string().trim().min(1), name: z.string(), can_prepare: z.boolean(),
}));

async function callDraftRpc<K extends keyof RpcContracts>(name: K, args: RpcContracts[K]["args"]) {
  const { data, error } = await draftClient.rpc(name, args);
  if (error) throw translateError(error);
  if (data == null) throw new TothOrderDraftError("O servidor não confirmou a operação. Atualize o rascunho para conferir.");
  const parsed = name === "toth_order_preparer_access" || name === "toth_set_order_preparer"
    ? preparersSchema.safeParse(data)
    : { success: true, data: parseTothOrderWorkspace(data, args.p_deal_id) };
  if (!parsed.success || !parsed.data) {
    throw new TothOrderDraftError("O servidor retornou dados inválidos para o rascunho. Atualize os dados antes de continuar.");
  }
  return parsed.data as RpcContracts[K]["result"];
}

export function useTothOrderDraft(dealId: string) {
  const { organizationId, teamMemberId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const queryKey = ["toth-order-workspace", organizationId, teamMemberId, dealId] as const;
  const preparersKey = ["toth-order-preparers", organizationId, teamMemberId, dealId] as const;
  const enabled = isReady && !!organizationId && !!teamMemberId && !!dealId;
  const workspace = useQuery({
    queryKey,
    queryFn: () => callDraftRpc("toth_order_workspace", { p_deal_id: dealId }),
    enabled,
    retry: false,
    staleTime: 15_000,
  });

  // Mutation observers replace callbacks on render. Capture the starting
  // account's key in onMutate so a response arriving after an account switch
  // cannot populate the new account's cache with the previous permissions.
  const updateWorkspace = (data: TothOrderWorkspace, key: typeof queryKey | undefined) => {
    if (!key) return;
    queryClient.setQueryData(key, data);
    void queryClient.invalidateQueries({ queryKey: key, exact: true });
  };
  const refreshAfterFailure = (key: typeof queryKey | undefined) => {
    if (key) void queryClient.invalidateQueries({ queryKey: key, exact: true });
  };

  const save = useMutation({
    mutationFn: ({ expectedRevision, input }: { expectedRevision: number; input: TothOrderDraftInput }) =>
      callDraftRpc("toth_save_order_draft", {
        p_deal_id: dealId, p_expected_revision: expectedRevision, p_items: input.items, p_notes: input.notes,
      }),
    onMutate: () => queryKey,
    onSuccess: (data, _variables, key) => updateWorkspace(data, key),
    onError: (_error, _variables, key) => refreshAfterFailure(key),
    retry: false,
  });
  const review = useMutation({
    mutationFn: (expectedRevision: number) => callDraftRpc("toth_review_order_draft", {
      p_deal_id: dealId, p_expected_revision: expectedRevision,
    }),
    onMutate: () => queryKey,
    onSuccess: (data, _variables, key) => updateWorkspace(data, key),
    onError: (_error, _variables, key) => refreshAfterFailure(key),
    retry: false,
  });
  const preparers = useQuery({
    queryKey: preparersKey,
    queryFn: () => callDraftRpc("toth_order_preparer_access", { p_deal_id: dealId }),
    enabled: enabled && !workspace.isError && workspace.data?.enabled === true && workspace.data.can_review === true,
    retry: false,
  });
  const setPreparer = useMutation({
    mutationFn: ({ teamMemberId, enabled }: { teamMemberId: string; enabled: boolean }) =>
      callDraftRpc("toth_set_order_preparer", {
        p_deal_id: dealId, p_team_member_id: teamMemberId, p_enabled: enabled,
      }),
    onMutate: () => ({ preparersKey, queryKey }),
    onSuccess: (data, _variables, keys) => {
      if (!keys) return;
      queryClient.setQueryData(keys.preparersKey, data);
      void queryClient.invalidateQueries({ queryKey: keys.preparersKey, exact: true });
      void queryClient.invalidateQueries({ queryKey: keys.queryKey, exact: true });
    },
    onError: (_error, _variables, keys) => {
      if (!keys) return;
      void queryClient.invalidateQueries({ queryKey: keys.preparersKey, exact: true });
      void queryClient.invalidateQueries({ queryKey: keys.queryKey, exact: true });
    },
    retry: false,
  });

  return { workspace, save, review, preparers, setPreparer, enabled, scopeKey: `${organizationId ?? ""}:${teamMemberId ?? ""}:${dealId}` };
}
