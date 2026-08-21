/**
 * usePaymentLinks — as propostas geradas pelo Master: listar, gerar, revogar.
 *
 * O TOKEN SÓ EXISTE UMA VEZ. A tabela guarda o SHA-256, nunca o texto, então a
 * geração é a ÚNICA oportunidade de copiar o link. Este hook devolve o token na
 * resposta da mutação e não o guarda em cache nenhum — quem exibe é a tela, uma
 * vez, e some.
 *
 * A LISTA NÃO MOSTRA COMPRADOR, e isso é decisão, não esquecimento. Nome,
 * documento e e-mail moram em `payment_link_buyers`, fechada por REVOKE — nem
 * `service_role` lê. Uma porta master-gated que devolvesse nome e e-mail para
 * `authenticated` recriaria exatamente a superfície que a Fatia 8 fechou, e por
 * uma LISTA, que é a tela que menos precisa. Se um dia o Master precisar
 * conferir o que preencheu, o caminho é ação por link, sob demanda e auditada.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * `src/integrations/supabase/types.ts` é AUTO-GERADO e está atrás do banco: não
 * conhece `payment_links` nem as RPCs de proposta, que nasceram nas fatias 5, 7
 * e 8. Sem escape, o `tsc` reprova com "Type instantiation is excessively deep"
 * e com o literal da RPC fora da união de nomes conhecidos.
 *
 * O escape fica AQUI, num cliente destipado local, e não espalhado em `as any`
 * pelas chamadas: assim a fronteira do que não é tipado tem um nome e um lugar,
 * e some numa linha quando alguém regenerar os tipos.
 *
 * NÃO regenerei nesta fatia de propósito: `types.ts` tem 270 KB, é consumido
 * por todo o repositório e regenerá-lo aqui esconderia a mudança de produto
 * dentro de um diff gigante que colide com qualquer PR aberto. É chore própria.
 */
const db = supabase as unknown as {
  from: (table: string) => {
    select: (columns: string) => {
      order: (
        column: string,
        opts: { ascending: boolean },
      ) => {
        limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const QUERY_KEY = ["master", "payment-links"];

export interface PaymentLinkRow {
  id: string;
  target_kind: "existing_org" | "new_org";
  organization_id: string | null;
  new_org_name: string | null;
  amount_cents: number;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  paid_at: string | null;
  manual_discount_cents: number | null;
  manual_discount_reason: string | null;
  package_features: Record<string, boolean>;
  package_limits: Record<string, number>;
  quote: Record<string, unknown> | null;
}

/**
 * O ESTADO É DERIVADO, e a ordem importa: pago vence revogado, revogado vence
 * expirado. Um link pago e depois revogado continua PAGO — o dinheiro entrou, e
 * mostrar "revogado" mandaria alguém procurar um pagamento que existe.
 */
export type PaymentLinkState = "paid" | "revoked" | "expired" | "active";

export function linkState(row: PaymentLinkRow, now: Date = new Date()): PaymentLinkState {
  if (row.paid_at) return "paid";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at) <= now) return "expired";
  return "active";
}

export function usePaymentLinks() {
  return useQuery<PaymentLinkRow[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      // Leitura direta: a policy `payment_links_master_read` já recorta por
      // `is_master_user()`. Não-master não enxerga linha nenhuma — é RLS, não
      // obscuridade, e por isso a tela não precisa repetir o gate.
      const { data, error } = await db
        .from("payment_links")
        .select(
          "id, target_kind, organization_id, new_org_name, amount_cents, expires_at, created_at, revoked_at, paid_at, manual_discount_cents, manual_discount_reason, package_features, package_limits, quote",
        )
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return (data ?? []) as unknown as PaymentLinkRow[];
    },
  });
}

export interface CreatePaymentLinkInput {
  targetKind: "existing_org" | "new_org";
  organizationId: string | null;
  newOrgName: string | null;
  planId: string;
  userCount: number;
  billingCycle: string;
  paymentMethod: string;
  expiresAt: string;
  packageFeatures: Record<string, boolean>;
  packageLimits: Record<string, number>;
  couponCode: string | null;
  /** ⚠️ MENSAL, não o total do ciclo. Ver `useBillingQuote` e a issue #1559. */
  manualFinalMonthlyCents: number | null;
  manualDiscountReason: string | null;
  /** Pré-preenchimento do comprador. Os três andam JUNTOS ou nenhum vai. */
  buyerLegalName: string | null;
  buyerTaxId: string | null;
  buyerEmail: string | null;
}

export interface CreatePaymentLinkResult {
  link_id: string;
  /** Texto do link. Existe só nesta resposta — não é recuperável depois. */
  token: string;
  amount_cents: number;
  expires_at: string;
  buyer_prefilled: boolean;
}

export function useCreatePaymentLink() {
  const queryClient = useQueryClient();

  return useMutation<CreatePaymentLinkResult, Error, CreatePaymentLinkInput>({
    mutationFn: async (input) => {
      const { data, error } = await db.rpc("billing_create_payment_link", {
        p_target_kind: input.targetKind,
        p_organization_id: input.organizationId,
        p_new_org_name: input.newOrgName,
        p_plan_id: input.planId,
        p_user_count: input.userCount,
        p_billing_cycle: input.billingCycle,
        p_payment_method: input.paymentMethod,
        p_expires_at: input.expiresAt,
        p_package_features: input.packageFeatures,
        p_package_limits: input.packageLimits,
        p_coupon_code: input.couponCode,
        // O nome do parâmetro no banco não diz "mensal"; o nosso diz. A
        // tradução acontece AQUI, num lugar só.
        p_manual_final_cents: input.manualFinalMonthlyCents,
        p_manual_discount_reason: input.manualDiscountReason,
        p_buyer_legal_name: input.buyerLegalName,
        p_buyer_tax_id: input.buyerTaxId,
        p_buyer_email: input.buyerEmail,
      });

      if (error) throw new Error(error.message);

      // CHECAGEM DE FORMA NO SEAM, porque o compilador não faz esse trabalho
      // aqui: o cliente acima é destipado, então drift no contrato da RPC
      // chegaria como `undefined` no diálogo — que abriria vazio, dizendo que
      // gerou uma proposta cujo link não existe. Um erro alto no ponto de
      // entrada custa uma linha; o silencioso custa a proposta.
      const r = data as Partial<CreatePaymentLinkResult> | null;
      if (!r || typeof r.token !== "string" || typeof r.link_id !== "string") {
        throw new Error(
          "A geração respondeu num formato inesperado — o link não foi entregue. Confira se a proposta existe na lista antes de gerar outra.",
        );
      }
      return {
        ...r,
        // `buyer_prefilled` é booleano no contrato; qualquer outra coisa vira
        // `false`, que é o lado seguro — pior avisar de menos que afirmar um
        // pré-preenchimento que não aconteceu.
        buyer_prefilled: r.buyer_prefilled === true,
      } as CreatePaymentLinkResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      // A mensagem do banco é a que serve: "Comprador incompleto: nome, e-mail
      // e documento fiscal andam juntos" diz o que fazer. Um "erro ao gerar
      // link" genérico não diz.
      toast.error(error.message);
    },
  });
}

export interface RevokePaymentLinkInput {
  linkId: string;
  /**
   * O motivo VIAJA para a auditoria. Revogação sem motivo é a mesma doença do
   * desconto sem motivo: seis meses depois ninguém sabe se foi engano de preço
   * ou desistência do cliente.
   */
  reason: string;
}

export function useRevokePaymentLink() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, RevokePaymentLinkInput>({
    mutationFn: async ({ linkId, reason }) => {
      const { error } = await db.rpc("billing_revoke_payment_link", {
        p_link_id: linkId,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Proposta revogada. O link deixou de resolver.");
    },
    onError: (error) => toast.error(error.message),
  });
}
