/**
 * Provisão de organização existente. A fila vem de `billing_pending_provisionings`,
 * com o anti-join no banco: o limite antes do anti-join deixava pagante de fora.
 */

export interface ProvisionDeps {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }>;
  log(entry: {
    action: string;
    status: "success" | "error" | "skipped";
    organizationId?: string;
    errorMessage?: string;
    payloadSnapshot?: Record<string, unknown>;
  }): Promise<void>;
}

export interface ProvisionSummary {
  pendentes: number;
  feito: string[];
  recusado: string[];
  falhou: string[];
  leituraFalhou: boolean;
}

export async function provisionExistingOrgs(limite: number, deps: ProvisionDeps): Promise<ProvisionSummary> {
  const resumo: ProvisionSummary = { pendentes: 0, feito: [], recusado: [], falhou: [], leituraFalhou: false };

  const { data, error } = await deps.rpc("billing_pending_provisionings", { p_limit: limite });
  if (error) {
    resumo.leituraFalhou = true;
    await deps.log({
      action: "provision_worker_falhou",
      status: "error",
      errorMessage: error.message ?? "fila ilegível",
    });
    return resumo;
  }

  const pendentes = (data ?? []) as { provider_payment_id: string; organization_id: string }[];
  resumo.pendentes = pendentes.length;

  for (const s of pendentes) {
    const pagamento = s.provider_payment_id;
    const organizationId = s.organization_id ?? undefined;
    const r = await deps.rpc("billing_provision_existing_org", { p_provider_payment_id: pagamento });

    if (r.error) {
      resumo.falhou.push(pagamento);
      // Vermelho visível: a linha continua pendente para a próxima passada.
      await deps.log({
        action: "provision_falhou",
        status: "error",
        organizationId,
        errorMessage: r.error.message ?? "erro desconhecido",
        payloadSnapshot: { payment_id: pagamento },
      });
      continue;
    }

    const resultado = (r.data ?? {}) as { ok?: boolean; code?: string };
    if (resultado.ok) {
      resumo.feito.push(pagamento);
      await deps.log({
        action: "provisionado",
        status: "success",
        organizationId,
        payloadSnapshot: { payment_id: pagamento, code: resultado.code },
      });
    } else {
      // Recusa esperada não é incidente: `skipped` para não afogar o sinal de erro real.
      resumo.recusado.push(pagamento);
      await deps.log({
        action: "provision_recusado",
        status: "skipped",
        organizationId,
        payloadSnapshot: { payment_id: pagamento, code: resultado.code },
      });
    }
  }

  return resumo;
}
