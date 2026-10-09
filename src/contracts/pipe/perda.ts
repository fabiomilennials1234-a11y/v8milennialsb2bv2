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

/**
 * A etapa de destino é de PERDA? Predicado ÚNICO de toda movimentação humana
 * que precisa pedir o motivo (requisito travado em 2026-10-09: qualquer tela,
 * não só o arrastar do `/funil`).
 *
 * Duas fontes, porque o catálogo de etapas tem as duas formas em produção:
 *  · `stage_role = 'lost'` — o papel semântico (ADR-0017 §1);
 *  · `is_final_negative = true` — a flag legada, que funis como o Mustang da
 *    Riofix usam com `stage_role = 'open'` (`perdido_desqualificado`).
 *
 * Só diz QUANDO perguntar. Não decide desfecho (decisão B2d: etapa não decide
 * ganho/perda — quem decide é `deals.outcome`).
 */
export interface EtapaComPapelDePerda {
  stage_role?: string | null;
  is_final_negative?: boolean | null;
}

export function isEtapaDePerda(stage: EtapaComPapelDePerda | null | undefined): boolean {
  if (!stage) return false;
  if (stage.stage_role === "lost") return true;
  // A flag legada só vale quando o papel não diz o contrário: etapa `won`
  // marcada negativa por engano é GANHO (SaleValueGuard/TinyERP leem o papel).
  return stage.is_final_negative === true && stage.stage_role !== "won";
}

/**
 * Texto do `title` da etapa de perda DESABILITADA em seletores que criam ou
 * movem negócio sem passar pelo gate do motivo (adicionar ao funil, abrir
 * negócio, mover em massa no modo adicionar).
 */
export const ETAPA_DE_PERDA_INDISPONIVEL =
  "Para registrar perda, mova o negócio pela etapa (pede o motivo)";

/**
 * Etapa padrão de um seletor que não pode nascer em perda: a primeira não-perda
 * da lista (já ordenada por posição). `undefined` quando todas são de perda.
 */
export function primeiraEtapaSemPerda<T extends EtapaComPapelDePerda>(
  stages: readonly T[] | null | undefined,
): T | undefined {
  return (stages ?? []).find((s) => !isEtapaDePerda(s));
}

/**
 * O que vai para `pipeline_entries.metadata` — as duas formas do motivo
 * (id do catálogo + rótulo snapshotado). Chave ausente quando o lado é nulo:
 * escrever `null` apagaria um motivo anterior no read-modify-write.
 */
// `type`, não `interface`: precisa caber em `Record<string, unknown>` (patch
// genérico de metadata) e em `Json` (update direto) sem cast.
export type PatchDaPerda = {
  loss_reason_id?: string;
  loss_reason?: string;
};

export function patchDaPerda(perda: PerdaResolvida): PatchDaPerda {
  return {
    ...(perda.id ? { loss_reason_id: perda.id } : {}),
    ...(perda.texto ? { loss_reason: perda.texto } : {}),
  };
}

/** Fallback quando a org não cadastrou motivos (mesma lista do PipePropostas). */
export const MOTIVOS_DE_PERDA_FALLBACK: MotivoDePerda[] = [
  { value: "sem_budget", label: "Sem budget", doCatalogo: false },
  { value: "concorrencia", label: "Concorrência", doCatalogo: false },
  { value: "timing", label: "Timing errado", doCatalogo: false },
  { value: "follow_up_fraco", label: "Follow-up fraco", doCatalogo: false },
  { value: "produto_nao_adequado", label: "Produto não adequado", doCatalogo: false },
  { value: "outro", label: "Outro", doCatalogo: false },
];
