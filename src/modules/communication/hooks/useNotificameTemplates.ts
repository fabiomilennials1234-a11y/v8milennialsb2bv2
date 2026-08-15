/**
 * Os templates HSM de um canal oficial (NotificaMe), para a tela.
 *
 * A leitura inteira mora no servidor (`notificame-templates`), e não numa query
 * direta: o token da subconta nunca sai do servidor, e a lista vem do
 * fornecedor, não do nosso banco. Aqui não há tabela para consultar — não
 * espelhamos template em Postgres de propósito, porque o status de aprovação
 * muda na Meta de forma assíncrona e uma cópia local nasceria desatualizada sem
 * ninguém saber quando.
 */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

/** Estados de aprovação da Meta. `null` = o fornecedor mandou algo desconhecido. */
export type NotificameTemplateStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED";

export type NotificameTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

/**
 * `POSITIONAL` = `{{1}}`, `{{2}}` … | `NAMED` = `{{nome}}`.
 *
 * Não é detalhe de exibição: decide o formato do parâmetro no ENVIO. Mandar um
 * pelo outro faz a Meta recusar com mensagem genérica e a mensagem simplesmente
 * não chega ao cliente. Por isso a tela mostra o formato, em vez de escondê-lo.
 */
export type NotificameTemplateParameterFormat = "POSITIONAL" | "NAMED";

export interface NotificameTemplateComponent {
  type: string;
  format?: string | null;
  text?: string | null;
  buttons?: unknown[] | null;
}

export interface NotificameTemplate {
  /** Nome canônico — é ele que o envio referencia, não o `id`. */
  name: string;
  id: string | null;
  language: string | null;
  status: NotificameTemplateStatus | null;
  category: NotificameTemplateCategory | null;
  parameterFormat: NotificameTemplateParameterFormat | null;
  components: NotificameTemplateComponent[];
}

export const notificameTemplatesQueryKey = (
  organizationId: string | null | undefined,
  instanceId: string | null | undefined,
) => ["notificame_templates", organizationId, instanceId] as const;

/**
 * Desembrulha o corpo de erro de `functions.invoke`.
 *
 * `FunctionsHttpError` esconde a mensagem dentro de `context` — sem isto todo
 * erro vira "Edge Function returned a non-2xx status code" e a tela não
 * consegue distinguir "sem permissão" de "canal de outra org" de "o fornecedor
 * caiu". Os três pedem reações diferentes do usuário.
 */
async function readInvokeError(error: unknown): Promise<{ code: string; message: string }> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = await (ctx as Response).json();
      if (body && typeof body === "object") {
        const { code, error: msg } = body as { code?: string; error?: string };
        if (code || msg) {
          return { code: code ?? "unknown", message: msg ?? "Falha ao ler os templates" };
        }
      }
    } catch {
      // Corpo não-JSON: cai no genérico abaixo.
    }
  }
  const message = error instanceof Error ? error.message : "Falha ao ler os templates";
  return { code: "unknown", message };
}

export class NotificameTemplatesError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NotificameTemplatesError";
    this.code = code;
  }
}

export function useNotificameTemplates({
  instanceId,
  enabled = true,
}: {
  instanceId: string | null | undefined;
  enabled?: boolean;
}) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: notificameTemplatesQueryKey(organizationId, instanceId),
    enabled: enabled && !!organizationId && !!instanceId,
    // O status de aprovação muda na Meta, não aqui. Meio minuto de frescor evita
    // refetch a cada foco de janela sem deixar a tela mentir por muito tempo.
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<NotificameTemplate[]> => {
      const { data, error } = await supabase.functions.invoke("notificame-templates", {
        body: { instance_id: instanceId },
      });

      if (error) {
        const { code, message } = await readInvokeError(error);
        throw new NotificameTemplatesError(code, message);
      }

      const templates = (data as { templates?: unknown })?.templates;
      return Array.isArray(templates) ? (templates as NotificameTemplate[]) : [];
    },
  });
}
