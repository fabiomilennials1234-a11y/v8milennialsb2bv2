/**
 * Fila da Lista Fria parada: decide se há busca que ninguém está atendendo.
 *
 * O healthcheck do container só vê worker que perdeu o banco. Não vê o worker desligado por engano, nem o
 * vivo porém preso numa busca (DEPLOY.md, seção 4). Pior: a recuperação de busca travada
 * (`lista_fria_worker_recuperar_travadas`) é chamada PELO worker, então com o worker morto a reserva de
 * créditos de quem está esperando fica retida e ninguém é avisado. Quem avisa é o `infra-watchdog`.
 *
 * Só enxerga o que há na fila: sem busca pendente não há sinal do worker para medir, e silêncio é o estado
 * normal (canal que fala todo dia vira ruído).
 */

/** Esperando sem que nenhuma busca esteja andando: ninguém atende. */
export const FILA_ESPERA_SEM_ATENDIMENTO_MIN = 5;
/** `executando` sem renovar o sinal. A recuperação do worker só age em 10 min; avisa na metade. */
export const FILA_SEM_SINAL_MIN = 5;
/** Esperando há muito tempo mesmo com o worker andando (busca longa na frente). */
export const FILA_LENTA_MIN = 30;

export interface BuscaDaFila {
  id: string;
  status: string;
  fonte: string;
  organization_id: string;
  created_at: string;
  heartbeat_at: string | null;
  worker_id: string | null;
}

export type MotivoDaFila = "ninguem_atende" | "worker_sem_sinal" | "fila_lenta";

export interface ProblemaDaFila {
  motivo: MotivoDaFila;
  /** Quantas buscas, e a mais antiga em minutos (esperando ou sem sinal). */
  buscas: number;
  minutos: number;
  organizacoes: string[];
  workers: string[];
}

const minutosDesde = (iso: string | null, agora: number): number => {
  const t = iso ? Date.parse(iso) : NaN;
  // Data ilegível conta como "sem sinal há muito": na dúvida, avisa.
  return Number.isFinite(t) ? Math.max(0, (agora - t) / 60_000) : Number.POSITIVE_INFINITY;
};

const unicos = (xs: Array<string | null>): string[] => [...new Set(xs.filter((x): x is string => !!x))];

/** Pura: recebe as buscas em aberto e devolve o que está errado (vazio = fila saudável). */
export function avaliarFila(buscas: BuscaDaFila[], agora: number = Date.now()): ProblemaDaFila[] {
  const problemas: ProblemaDaFila[] = [];

  const executando = buscas.filter((b) => b.status === "executando");
  const semSinal = executando.filter((b) => minutosDesde(b.heartbeat_at, agora) >= FILA_SEM_SINAL_MIN);
  const andando = executando.length > semSinal.length;

  if (semSinal.length > 0) {
    problemas.push({
      motivo: "worker_sem_sinal",
      buscas: semSinal.length,
      minutos: Math.max(...semSinal.map((b) => minutosDesde(b.heartbeat_at, agora))),
      organizacoes: unicos(semSinal.map((b) => b.organization_id)),
      workers: unicos(semSinal.map((b) => b.worker_id)),
    });
  }

  const naFila = buscas.filter((b) => b.status === "na_fila");
  if (naFila.length > 0) {
    const espera = Math.max(...naFila.map((b) => minutosDesde(b.created_at, agora)));
    const motivo: MotivoDaFila | null = !andando && espera >= FILA_ESPERA_SEM_ATENDIMENTO_MIN
      ? "ninguem_atende"
      : andando && espera >= FILA_LENTA_MIN
      ? "fila_lenta"
      : null;
    if (motivo) {
      problemas.push({
        motivo,
        buscas: naFila.length,
        minutos: espera,
        organizacoes: unicos(naFila.map((b) => b.organization_id)),
        workers: [],
      });
    }
  }

  return problemas;
}

const arredonda = (min: number): string => (Number.isFinite(min) ? `${Math.round(min)} min` : "tempo desconhecido");
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/** Texto do aviso. `nomes` mapeia id da org → nome (quem acorda decide sem abrir o banco). */
export function textoDaFila(problemas: ProblemaDaFila[], nomes: Map<string, string>): string {
  const orgs = (ids: string[]) => ids.map((id) => nomes.get(id) ?? id).join(", ");
  const linhas = problemas.map((p) => {
    const quem = `Org: ${orgs(p.organizacoes)}`;
    switch (p.motivo) {
      case "ninguem_atende":
        return `• *Ninguém está atendendo*: ${plural(p.buscas, "busca espera", "buscas esperam")} há ${arredonda(p.minutos)}, ` +
          `sem nenhuma em andamento. ${quem}`;
      case "worker_sem_sinal":
        return `• *Worker sem sinal*: ${plural(p.buscas, "busca", "buscas")} em andamento sem renovar o sinal há ` +
          `${arredonda(p.minutos)}${p.workers.length ? ` (${p.workers.join(", ")})` : ""}. ${quem}`;
      case "fila_lenta":
        return `• *Fila lenta*: a mais antiga espera há ${arredonda(p.minutos)}, mesmo com o worker andando ` +
          `(${plural(p.buscas, "busca", "buscas")}). ${quem}`;
    }
  });
  return `🔴 *Lista fria: fila parada*\n\n${linhas.join("\n")}\n\n` +
    `Os créditos reservados ficam retidos até a busca fechar. Ver o serviço lista-fria-worker no EasyPanel ` +
    `(logs e reinício). Se o worker voltar, ele mesmo fecha as travadas há 10 min e devolve a reserva.`;
}
