/**
 * Texto do alerta do INV-5 — tabela de `public` legível por `anon`/
 * `authenticated` sem RLS.
 *
 * Vive separado do `infra-watchdog` pelo mesmo motivo que o laço de exclusão de
 * instância virou `_shared/whatsapp-instance-delete.ts`: para ser testável sem
 * subir a edge function. E o que precisa de teste aqui não é enfeite — é o
 * requisito de que o alerta diga QUAL tabela e QUANTAS. Alerta que só diz "há
 * violação" obriga quem acordou às 4h a abrir o banco antes de decidir
 * qualquer coisa, e nessa hora o alerta já falhou.
 */

export type Inv5Violacao = { tabela?: string; grantees?: string[] };

export type Inv5Payload = {
  total?: number;
  truncado?: boolean;
  violacoes?: Inv5Violacao[];
};

/** Quantas tabelas cabem no texto antes de virar parede. */
export const INV5_MAX_TABELAS_NO_TEXTO = 8;

export function buildInv5AlertText(payload: Inv5Payload, scannedAt: string): string {
  const violacoes = Array.isArray(payload?.violacoes) ? payload.violacoes : [];
  // `total` manda sobre o tamanho da lista: a varredura trunca o array em 50 e
  // mantém a contagem real, então usar `violacoes.length` reportaria menos
  // violação do que existe — exatamente o erro que o `truncado` existe para
  // impedir.
  const total = Number.isFinite(Number(payload?.total))
    ? Number(payload.total)
    : violacoes.length;

  const mostradas = violacoes.slice(0, INV5_MAX_TABELAS_NO_TEXTO);
  const nomeadas = mostradas
    .map(v => `• \`${v?.tabela ?? "?"}\` → ${(v?.grantees ?? []).join(", ") || "?"}`)
    .join("\n");

  const resto = total - mostradas.length;
  const sobra = resto > 0 ? `\n…e mais ${resto}.` : "";

  const quando = String(scannedAt ?? "").slice(0, 16).replace("T", " ");

  return (
    `🔴 *Tabela exposta em público (INV-5)*\n\n` +
    `${total} ${total === 1 ? "tabela está legível" : "tabelas estão legíveis"} ` +
    `sem RLS:\n${nomeadas || "• (payload sem detalhe — consultar o detector)"}${sobra}\n\n` +
    `\`anon\` é a chave publicável que vai no bundle do front — quem tiver a URL ` +
    `do projeto lê a tabela inteira. \`authenticated\` significa que usuário de ` +
    `QUALQUER organização lê tudo.\n\n` +
    `Conserto: \`ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;\` ou, se for ` +
    `tabela avulsa que ninguém deve ler, ` +
    `\`REVOKE SELECT ON public.<t> FROM anon, authenticated;\`\n` +
    `NÃO mexa no \`ALTER DEFAULT PRIVILEGES\` — ele é load-bearing, o PostgREST ` +
    `depende dele.\n\n` +
    `Varredura de ${quando} UTC.`
  );
}
