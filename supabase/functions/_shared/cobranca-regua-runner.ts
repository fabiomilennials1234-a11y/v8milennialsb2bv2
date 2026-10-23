/**
 * O laço da régua de cobrança (ADR-0040): reserva → texto → número existe? →
 * envia → grava no chat → conclui. Sem I/O próprio: tudo entra por `deps`, o
 * que deixa o laço provável com dublês (tests/unit/cobranca-regua-runner.test.ts).
 *
 * Quem decide QUEM e QUANDO é o banco (`cobranca_regua_planejar` e
 * `cobranca_regua_reservar`: janela, teto, ritmo, revalidação). Aqui só se
 * executa o envio reservado e se devolve o resultado, classificado:
 *
 *   enviado       → o fornecedor aceitou
 *   sem_whatsapp  → o número não tem WhatsApp (não adianta tentar de novo)
 *   retentar      → é CERTO que não saiu (breaker, instância indisponível…);
 *                   o banco agenda de novo com espera crescente, até 3 vezes
 *   falhou        → qualquer outra coisa. Envio de WhatsApp não é idempotente:
 *                   500/timeout podem ter entregue — na cobrança, perder uma
 *                   mensagem é melhor que mandar duas.
 *
 * ⚠️ Depois que o fornecedor aceitou, NADA aqui lança: gravar no chat é
 * melhor-esforço, e a conclusão acontece de qualquer jeito. Um throw ali
 * deixaria o envio em 'enviando' até o lease vencer, e ele viraria "incerto".
 */
import { renderizarMensagem, type VariaveisDaRegua } from "./cobranca-regua-mensagem.ts";

export type EnvioReservado = {
  envio_id: string;
  organization_id: string;
  instancia_id: string;
  telefone: string;
  mensagem: string | null;
  variaveis: VariaveisDaRegua | null;
};

export type ResultadoDoEnvio = "enviado" | "retentar" | "falhou" | "sem_whatsapp";

export type InstanciaDaRegua = { id: string; organization_id: string; provider: string | null };

export type DepsDaRegua = {
  reservar: (lote: number) => Promise<EnvioReservado[]>;
  concluir: (args: {
    envioId: string;
    resultado: ResultadoDoEnvio;
    texto?: string | null;
    providerMessageId?: string | null;
    erro?: string | null;
  }) => Promise<void>;
  carregarInstancia: (id: string) => Promise<InstanciaDaRegua | null>;
  /** `null` = alcançável; string = motivo de não ser (ex.: não tem WhatsApp). */
  verificarNumero: (instancia: InstanciaDaRegua, telefone: string) => Promise<string | null>;
  enviarTexto: (
    instancia: InstanciaDaRegua,
    telefone: string,
    texto: string,
    opts: { trackSource: string; trackId: string; idempotencyKey: string },
  ) => Promise<{ success: boolean; messageId?: string; whatsappMessageId?: string; error?: string }>;
  gravarNoChat: (args: {
    instancia: InstanciaDaRegua;
    telefone: string;
    texto: string;
    providerMessageId: string | null;
  }) => Promise<void>;
  /** Mesma regra do resto do produto: só o que provadamente não saiu. */
  ehRetentavel: (erro: string | undefined | null) => boolean;
};

export type ResumoDoTique = {
  reservados: number;
  enviados: number;
  falhas: number;
  retentativas: number;
  semWhatsapp: number;
};

export const TRACK_SOURCE_DA_REGUA = "cobranca";

const NAO_TEM_WHATSAPP = /not[_ ]on[_ ]whatsapp|recipient_not_on_whatsapp|n[aã]o (est[aá]|tem).*whatsapp/i;

export function classificarFalha(erro: string | undefined | null, ehRetentavel: DepsDaRegua["ehRetentavel"]): ResultadoDoEnvio {
  if (NAO_TEM_WHATSAPP.test(erro ?? "")) return "sem_whatsapp";
  if (ehRetentavel(erro)) return "retentar";
  return "falhou";
}

export async function processarTiqueDaRegua(deps: DepsDaRegua, opts: { lote: number }): Promise<ResumoDoTique> {
  const resumo: ResumoDoTique = { reservados: 0, enviados: 0, falhas: 0, retentativas: 0, semWhatsapp: 0 };
  const reservados = await deps.reservar(opts.lote);
  resumo.reservados = reservados.length;
  const instancias = new Map<string, InstanciaDaRegua | null>();

  const concluir = async (
    envioId: string,
    resultado: ResultadoDoEnvio,
    extra: { texto?: string | null; providerMessageId?: string | null; erro?: string | null } = {},
  ) => {
    await deps.concluir({ envioId, resultado, ...extra });
    if (resultado === "enviado") resumo.enviados++;
    else if (resultado === "retentar") resumo.retentativas++;
    else if (resultado === "sem_whatsapp") resumo.semWhatsapp++;
    else resumo.falhas++;
  };

  for (const r of reservados) {
    try {
      const texto = renderizarMensagem(r.mensagem ?? "", r.variaveis ?? {});
      if (!texto) {
        await concluir(r.envio_id, "falhou", { erro: "mensagem_vazia" });
        continue;
      }

      if (!instancias.has(r.instancia_id)) instancias.set(r.instancia_id, await deps.carregarInstancia(r.instancia_id));
      const instancia = instancias.get(r.instancia_id) ?? null;
      if (!instancia) {
        // O banco só reserva com instância conectada; sumiu no meio = não saiu.
        await concluir(r.envio_id, "retentar", { erro: "no_instance" });
        continue;
      }

      const bloqueio = await deps.verificarNumero(instancia, r.telefone);
      if (bloqueio) {
        await concluir(r.envio_id, "sem_whatsapp", { erro: bloqueio });
        continue;
      }

      const res = await deps.enviarTexto(instancia, r.telefone, texto, {
        trackSource: TRACK_SOURCE_DA_REGUA,
        trackId: r.envio_id,
        idempotencyKey: `cobranca:${r.envio_id}`,
      });

      if (!res.success) {
        await concluir(r.envio_id, classificarFalha(res.error, deps.ehRetentavel), { erro: res.error ?? "erro desconhecido" });
        continue;
      }

      const providerMessageId = res.whatsappMessageId ?? res.messageId ?? null;
      try {
        await deps.gravarNoChat({ instancia, telefone: r.telefone, texto, providerMessageId });
      } catch (e) {
        console.error("[cobranca-regua] gravar no chat falhou (envio saiu):", (e as Error).message);
      }
      // Saiu: daqui em diante só 'enviado'. Se nem a segunda tentativa de
      // concluir passar, o lease vence e o banco registra "incerto" — nunca
      // "falhou", que convidaria alguém a mandar de novo.
      for (let tentativa = 1; tentativa <= 2; tentativa++) {
        try {
          await concluir(r.envio_id, "enviado", { texto, providerMessageId });
          break;
        } catch (e) {
          console.error(`[cobranca-regua] concluir 'enviado' falhou (${tentativa}/2):`, (e as Error).message);
        }
      }
    } catch (e) {
      // Erro ANTES de enviar (render, instância, verificação): não saiu.
      // Conservador mesmo assim — 'falhou', não 'retentar': a causa é desconhecida.
      console.error("[cobranca-regua] envio interrompido:", (e as Error).message);
      try {
        await concluir(r.envio_id, "falhou", { erro: `interrompido: ${(e as Error).message}`.slice(0, 300) });
      } catch (e2) {
        console.error("[cobranca-regua] concluir falhou; o lease vence e o banco marca incerto:", (e2 as Error).message);
      }
    }
  }
  return resumo;
}
