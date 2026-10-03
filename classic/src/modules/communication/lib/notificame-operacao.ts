/**
 * notificame-operacao — leitura das respostas de operação do canal oficial.
 *
 * ⚠️ NENHUM destes formatos foi medido contra conta viva. A doc do fornecedor
 * mostra o corpo da REQUISIÇÃO e uma IMAGEM da resposta — não o JSON. Por isso
 * os leitores tentam vários caminhos e, quando não reconhecem, dizem que não
 * sabem.
 *
 * O corpo cru viaja junto de propósito: quando o primeiro número real for
 * consultado, é ele que ensina o formato de verdade.
 */

export type NivelDeSaude = "verde" | "amarelo" | "vermelho";

export interface SaudeDoNumero {
  nivel: NivelDeSaude;
  /** O corpo integral, para quem for investigar ou ajustar o leitor. */
  cru: unknown;
}

const POR_COR: Record<string, NivelDeSaude> = {
  green: "verde",
  yellow: "amarelo",
  red: "vermelho",
  verde: "verde",
  amarelo: "amarelo",
  vermelho: "vermelho",
};

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * O nível de saúde, ou `null` quando o corpo não é reconhecido.
 *
 * ⚠️ `null` NUNCA vira verde na tela. Um verde inventado diria ao admin que está
 * tudo bem com o número dele — a mentira mais cara que este leitor poderia
 * contar, porque a nota vermelha é o degrau antes de a Meta limitar o envio.
 */
export function lerSaudeDoNumero(resposta: unknown): SaudeDoNumero | null {
  if (!resposta || typeof resposta !== "object") return null;

  const r = resposta as Record<string, unknown>;
  const dados = (r.data && typeof r.data === "object" ? r.data : r) as Record<string, unknown>;

  for (const chave of ["health_status", "status", "health", "quality", "quality_rating"]) {
    const nivel = POR_COR[texto(dados[chave])];
    if (nivel) return { nivel, cru: resposta };
  }

  return null;
}

/**
 * Os números bloqueados. Lista vazia quando o formato não é reconhecido — é
 * honesto ("não sei quem está bloqueado") e não derruba o card inteiro por causa
 * de uma seção.
 */
export function lerBloqueados(resposta: unknown): string[] {
  const lista = Array.isArray(resposta)
    ? resposta
    : resposta && typeof resposta === "object"
    ? (["blocked", "data", "users", "contacts"]
      .map((k) => (resposta as Record<string, unknown>)[k])
      .find(Array.isArray) as unknown[] | undefined) ?? []
    : [];

  return lista
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const x = item as Record<string, unknown>;
        return (
          texto(x.phone) || texto(x.wa_id) || texto(x.number) || texto(x.user) || ""
        );
      }
      return "";
    })
    .filter((x) => x !== "");
}
