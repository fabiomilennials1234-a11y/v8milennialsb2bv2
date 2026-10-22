/**
 * "Próxima ação" de um caso — o que a lista e o card dizem ao cobrador.
 *
 * Só fatos que o banco tem: compromisso ativo, responsável, contato registrado,
 * "não contatar". Na entrega 1 não há régua, então nada aqui promete toque
 * automático (a régua entra na entrega 2 e ganha a sua própria linha).
 */
import { atrasoDe, diaCurto, diasDesdeVencimento, haQuantoTempo, isoDia } from "./atraso";
import { reais } from "./formato";
import type { InadimplenteResumo } from "./tipos";

export type IconeDaAcao = "compromisso" | "atrasado" | "sem_dono" | "sem_contato" | "nao_contatar" | "contato" | "encerrado";
export type TomDaAcao = "ouro" | "alerta" | "aviso" | "neutro" | "bom";

export interface ProximaAcao {
  icone: IconeDaAcao;
  texto: string;
  tom: TomDaAcao;
}

export function proximaAcao(r: InadimplenteResumo, hoje: Date = new Date()): ProximaAcao {
  if (!r.casoId) {
    if (r.ultimoDesfecho === "recuperado") return { icone: "encerrado", texto: "Recuperado", tom: "bom" };
    if (r.ultimoDesfecho) return { icone: "encerrado", texto: r.ultimoDesfecho === "perdido" ? "Baixado como perda" : "Cancelado", tom: "neutro" };
    return { icone: "encerrado", texto: "Sem dívida em aberto", tom: "neutro" };
  }

  if (r.compromissoTipo && r.compromissoProximaVencimento) {
    const venc = r.compromissoProximaVencimento;
    const atraso = atrasoDe(venc, hoje);
    const valor = r.compromissoProximaValor != null ? ` · ${reais(r.compromissoProximaValor)}` : "";
    if (atraso && atraso.dias > 0) {
      return { icone: "atrasado", texto: `${r.compromissoTipo === "promessa" ? "Promessa" : "Parcela"} venceu em ${diaCurto(venc, hoje)}`, tom: "alerta" };
    }
    const quando = atraso?.dias === 0 ? "hoje" : diaCurto(venc, hoje);
    return {
      icone: "compromisso",
      texto: r.compromissoTipo === "promessa" ? `Promessa ${quando}${valor}` : `Parcela ${quando}${valor}`,
      tom: "ouro",
    };
  }

  if (r.naoContatar) return { icone: "nao_contatar", texto: "Pediu para não receber mensagens", tom: "aviso" };
  if (!r.responsavelId) return { icone: "sem_dono", texto: "Sem responsável, atribuir", tom: "ouro" };

  if (!r.ultimoContatoEm) return { icone: "sem_contato", texto: "Nenhum contato registrado", tom: "aviso" };
  const dias = diasDesdeVencimento(isoDia(new Date(r.ultimoContatoEm)), hoje);
  if (dias >= 7) return { icone: "sem_contato", texto: `Sem contato há ${dias} dias`, tom: "aviso" };
  return { icone: "contato", texto: `Último contato ${haQuantoTempo(r.ultimoContatoEm, hoje)}`, tom: "neutro" };
}
