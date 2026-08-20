/**
 * enviar-template — o envio de um template aprovado por AUTOMAÇÃO.
 *
 * Extraído de `send-whatsapp-rich.ts` quando um SEGUNDO caminho passou a
 * precisar dele: o escape de janela do nó de texto (#1689). Antes disso era o
 * corpo do nó de template (#1688) e viver lá dentro estava certo; com dois
 * chamadores, deixar lá significaria duas cópias do mesmo trecho de transporte
 * — e a que não fosse mantida seria a que o cliente veria.
 *
 * ⚠️ ESTE MÓDULO NÃO DECIDE NADA. Ele não pergunta se a janela está aberta, se
 * o canal é oficial, nem se havia template configurado — isso é
 * `decisao-de-envio.ts`, e é lá que a regra tem de continuar legível. Aqui só
 * mora o "como": remontar a forma aprovada, resolver os valores contra o lead e
 * entregar ao transporte.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { EscapeResolvido } from "../decisao-de-envio.ts";
import { resolveVariables } from "./whatsapp-helpers.ts";

export type ResultadoDeTemplate =
  | { ok: true; nome: string }
  /** `retryable` ausente = o executor decide (o default dele é retentar). */
  | { ok: false; erro: string; retryable?: boolean };

export async function enviarTemplateAprovado(params: {
  supabase: SupabaseClient;
  leadId: string;
  executionContext?: Record<string, unknown>;
  /** A Instance JÁ resolvida pelo nó — o template sai pelo mesmo número. */
  instance: unknown;
  phone: string;
  /** Nome, idioma, forma aprovada, mapa de variáveis e mídia de cabeçalho. */
  template: EscapeResolvido;
  trackSource: string;
  trackId?: string;
}): Promise<ResultadoDeTemplate> {
  const { supabase, leadId, executionContext, instance, phone, template } = params;

  // ⚠️ O EXECUTOR NÃO LISTA OS TEMPLATES, e isto é uma troca consciente.
  //
  // Listar exigiria refazer aqui todo o caminho de cofre — carregar a subconta,
  // decifrar o token, montar a config — só para validar um nome. Em vez disso o
  // envio referencia o template pelo nome e o fornecedor recusa na resposta do
  // POST, de forma síncrona: o motivo dele chega ao passo da execução.
  //
  // A FORMA do template — quantas variáveis, se tem cabeçalho de mídia — vem do
  // que o NÓ guardou quando alguém o escolheu na tela, que é onde a listagem
  // acontece com login de usuário.
  const aprovado = {
    name: template.name,
    id: null,
    language: template.language,
    status: "APPROVED" as const,
    category: null,
    parameterFormat: null,
    components: template.components as never,
  } as unknown as import("../notificame-templates.ts").NotificameTemplate;

  // A REGRA COMPOSTA do template decide tudo num lugar só: resolve os valores
  // contra o lead, confere o que falta e monta os componentes. Pendência barra o
  // envio — a Meta recusa parâmetro vazio, e a recusa dela chega depois de o
  // vendedor achar que mandou.
  const { prepararEnvioDeTemplate } = await import("../template-node-valores.ts");
  const preparado = await prepararEnvioDeTemplate({
    template: aprovado,
    mapeamento: template.variables,
    resolver: (texto) => resolveVariables(supabase, leadId, texto, executionContext),
    headerMediaUrl: template.headerMediaUrl,
  });

  if (!preparado.ok) {
    return {
      ok: false,
      erro: `Template incompleto — falta: ${preparado.pendencias.join(", ")}`,
      retryable: false,
    };
  }

  const { sendTemplateViaInstance } = await import("../whatsapp-dispatch.ts");
  const sendResult = await sendTemplateViaInstance(
    supabase,
    instance as never,
    phone,
    {
      name: aprovado.name,
      language: template.language,
      components: preparado.components,
      previewText: preparado.previewText,
      buttonLabels: preparado.buttonLabels,
    },
    { trackSource: params.trackSource, trackId: params.trackId },
  );

  if (!sendResult.success) {
    // Sem `retryable`: preserva byte-a-byte o que o nó de template já fazia —
    // falha de envio volta ao executor sem veredito, e ele retenta. Fixar `false`
    // aqui seria mudar, de carona numa extração, o comportamento de um nó que
    // não é o assunto desta issue.
    return { ok: false, erro: `Template send failed: ${sendResult.error}` };
  }

  // ⚠️ NÃO grava a linha. O provider do canal oficial já a escreve, no mesmo
  // instante do envio — gravar de novo aqui duplicaria a mensagem na conversa.
  return { ok: true, nome: aprovado.name };
}
