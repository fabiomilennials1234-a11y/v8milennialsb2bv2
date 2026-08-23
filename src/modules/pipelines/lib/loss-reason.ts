/**
 * Resolução do motivo da perda (SCRUM-369).
 *
 * Mora fora do componente porque é a regra, não a tela: qual das duas colunas
 * recebe o quê, e quando a escolha ainda está incompleta. A tela só liga ou
 * desliga o botão com a resposta.
 *
 * ## Por que DUAS formas, e não só o id
 *
 * `loss_reasons` é catálogo editável por organização. Guardando só o id, um
 * motivo renomeado muda o passado e um motivo apagado deixa o histórico com um
 * ponteiro para nada. O texto é o RÓTULO SNAPSHOTADO no instante da perda —
 * mesma disciplina do `sale_responsible_id` snapshotado em `sale_events`
 * (ADR-0017 §2).
 *
 * ## Por que o id só sai do catálogo
 *
 * A tela cai numa lista de fallback (slugs como `sem_budget`) quando a org não
 * cadastrou motivos. Gravar esses slugs em `loss_reason_id` criaria uma FK
 * apontando para linha inexistente. Fallback vira texto e só.
 */

export interface MotivoDePerda {
  value: string;
  label: string;
  /** `true` quando veio de `loss_reasons` (tem id de verdade). */
  doCatalogo: boolean;
}

export interface PerdaResolvida {
  /** FK para `loss_reasons`. `null` quando o motivo veio do fallback. */
  id: string | null;
  /** Rótulo snapshotado, ou o texto livre quando o motivo é "Outro". */
  texto: string | null;
}

/** Mínimo de caracteres no texto livre. Três separa "ok" de uma palavra. */
export const MINIMO_DO_TEXTO_LIVRE = 3;

/** O motivo escolhido é do tipo "Outro" e por isso exige texto? */
export function exigeTextoLivre(
  selecionado: string,
  motivos: MotivoDePerda[],
): boolean {
  const escolhido = motivos.find((r) => r.value === selecionado);
  if (!escolhido) return false;
  // Casa "Outro", "Outros", "outro motivo" — o catálogo é editável por org e
  // cada uma escreve do seu jeito.
  return /^outr/i.test(escolhido.label) || /^outr/i.test(escolhido.value);
}

/**
 * `null` significa ESCOLHA INCOMPLETA — nada a gravar, e o botão de confirmar
 * fica desligado.
 *
 * A obrigatoriedade é decisão do CTO (2026-08-21): antes o campo dizia
 * "opcional", ninguém preenchia, e a métrica de motivos de perda nasceu vazia
 * em 99 organizações — 72 negócios perdidos, zero com motivo.
 */
export function resolverMotivoDaPerda(
  selecionado: string,
  nota: string,
  motivos: MotivoDePerda[],
): PerdaResolvida | null {
  if (!selecionado) return null;
  const escolhido = motivos.find((r) => r.value === selecionado);
  if (!escolhido) return null;

  const ehOutro = exigeTextoLivre(selecionado, motivos);
  const texto = nota.trim();

  // "Outro" sem texto é o mesmo vazio com outro nome: um balde que concentra
  // os casos e não diz nada sobre nenhum deles.
  if (ehOutro && texto.length < MINIMO_DO_TEXTO_LIVRE) return null;

  return {
    id: escolhido.doCatalogo ? escolhido.value : null,
    texto: ehOutro ? texto : escolhido.label,
  };
}
