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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
async function readInvokeError(
  error: unknown,
): Promise<{ code: string; message: string; problems: TemplateProblem[] }> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = await (ctx as Response).json();
      if (body && typeof body === "object") {
        // Dois formatos no servidor: as nossas recusas trazem `{ error: <frase>,
        // code }`, e `authErrorResponse` traz `{ error: "Forbidden", message: <frase> }`
        // — ali `error` é a CATEGORIA. Ler só `error` põe a palavra "Forbidden"
        // na tela e esconde o motivo; foi o que aconteceu no envio pelo Direct.
        const { code, error: rotulo, message, problems } = body as {
          code?: string;
          error?: string;
          message?: string;
          problems?: TemplateProblem[];
        };
        const humana = code ? rotulo : (message ?? rotulo);
        if (code || humana) {
          return {
            code: code ?? (rotulo ? rotulo.toLowerCase() : "unknown"),
            message: humana ?? "Falha ao ler os templates",
            problems: Array.isArray(problems) ? problems : [],
          };
        }
      }
    } catch {
      // Corpo não-JSON: cai no genérico abaixo.
    }
  }
  const message = error instanceof Error ? error.message : "Falha ao ler os templates";
  return { code: "unknown", message, problems: [] };
}

/** Um problema que a Meta recusaria, apontado ANTES da submissão. */
export interface TemplateProblem {
  code: string;
  message: string;
  field?: string;
}

export class NotificameTemplatesError extends Error {
  readonly code: string;
  /** Preenchido quando o servidor recusou o rascunho (`template_invalid`). */
  readonly problems: TemplateProblem[];
  constructor(code: string, message: string, problems: TemplateProblem[] = []) {
    super(message);
    this.name = "NotificameTemplatesError";
    this.code = code;
    this.problems = problems;
  }
}

export interface TemplateDraftInput {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components: { type: string; format?: string; text?: string }[];
}

/**
 * Submete um template à Meta.
 *
 * ⚠️ O sucesso aqui é `PENDING`, não "pronto para usar": a Meta ainda vai
 * revisar, e isso leva horas. Quem chama tem que dizer isso na tela, senão o
 * usuário lê "criado" e tenta enviar em seguida — e o envio falha.
 */
export function useCreateNotificameTemplate(instanceId: string) {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  return useMutation({
    mutationFn: async (draft: TemplateDraftInput) => {
      // `notificame-templates` é org-scoped (`requireOrganization: true`) e
      // recusa com 400 sem a org no corpo. Mesmo defeito que matou o envio pelo
      // Direct; aqui ainda não tinha aparecido só porque a tela nunca foi usada
      // em produção (zero chamadas em `function_edge_logs`).
      if (!organizationId) {
        throw new NotificameTemplatesError("no_org", "Sua organização ainda está carregando");
      }

      const { data, error } = await supabase.functions.invoke("notificame-templates", {
        body: {
          organization_id: organizationId,
          action: "create",
          instance_id: instanceId,
          template: draft,
        },
      });

      if (error) {
        const { code, message, problems } = await readInvokeError(error);
        throw new NotificameTemplatesError(code, message, problems);
      }
      return data as { template: { id: string | null; status: string | null } };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: notificameTemplatesQueryKey(organizationId, instanceId),
      });
    },
  });
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
        // `enabled` já exige a org; mandá-la no corpo é o que a função pede.
        body: { organization_id: organizationId, instance_id: instanceId },
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
