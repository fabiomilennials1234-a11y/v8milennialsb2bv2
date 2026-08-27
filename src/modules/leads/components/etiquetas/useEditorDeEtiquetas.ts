import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { useCreateTag, useTags } from "../../hooks/useTags";
import {
  useAddLeadTag,
  useLeadTagsAttached,
  useRemoveLeadTag,
} from "../../hooks/lead/useLeadTagsAttached";

/**
 * Toda a mecânica de etiquetar um lead, num lugar só.
 *
 * ── POR QUE UM HOOK, E NÃO TRÊS CÓPIAS ────────────────────────────────────
 * A etiqueta do lead é escrita hoje de três superfícies diferentes — a faixa
 * do card do Lead (`LeadCardEtiquetas`), o card do quadro e a linha da lista —
 * e cada uma tem um desenho próprio: uma mostra as pílulas por fora, as outras
 * cabem num botão de 16px. O que NÃO muda entre elas é o que dá errado:
 * `tag` nulo pela RLS, catálogo ainda carregando lido como catálogo vazio,
 * `DELETE` que casa zero linhas, nome acentuado que nasce gêmeo, e o par
 * criar+pendurar que pode falhar no meio. Duplicar isso em três arquivos é
 * duplicar cinco armadilhas — e consertar uma delas em dois lugares.
 *
 * Este hook é o miolo; os componentes acima dele são só desenho.
 */

/** Cor estável a partir do nome, para etiqueta nova não nascer cinza. */
const PALETA = [
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
];

function corDoNome(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 997;
  return PALETA[h % PALETA.length];
}

/**
 * Dobra acento e caixa para comparar NOME de etiqueta.
 *
 * Sem isto, "Não responde" e "Nao responde" são nomes diferentes: a busca não
 * acha a que existe e o "Criar" se oferece para fazer a gêmea. O catálogo é
 * por organização e pequeno; duas entradas com o mesmo nome quebram o filtro do
 * quadro em silêncio, porque ele casa por id e a pessoa escolhe pelo nome.
 */
export function dobrar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Traduz a recusa do banco. Sem isto, o toast repete a mensagem do PostgREST
 * ("new row violates row-level security policy for table \"tags\"") — que é
 * verdadeira e não diz a ninguém o que fazer a seguir.
 *
 * O 23505 depende de QUAL escrita falhou: em `tags` é colisão de NOME no
 * catálogo da organização; em `lead_tags` é a etiqueta já pendurada neste lead.
 * A mesma frase para os dois manda a pessoa procurar no lugar errado.
 */
export function motivo(erro: unknown, acao: "criar" | "pendurar" | "remover"): string {
  const bruto =
    erro instanceof Error
      ? erro.message
      : typeof erro === "object" && erro !== null && "message" in erro
        ? String((erro as { message: unknown }).message)
        : String(erro ?? "");

  if (/row-level security|42501|permission denied/i.test(bruto)) {
    return acao === "criar"
      ? "Só administradores criam etiquetas novas. Peça em Configurações › Tags."
      : "Você não tem permissão para mudar as etiquetas deste lead.";
  }
  if (/duplicate key|23505/i.test(bruto)) {
    return acao === "criar"
      ? "Já existe uma etiqueta com esse nome nesta organização."
      : "Esta etiqueta já está no lead.";
  }
  return acao === "criar"
    ? "Não foi possível criar a etiqueta."
    : acao === "pendurar"
      ? "Não foi possível adicionar a etiqueta."
      : "Não foi possível remover a etiqueta.";
}

export function useEditorDeEtiquetas(leadId: string, aoPendurar?: () => void) {
  const { data: presasBrutas = [], isLoading } = useLeadTagsAttached(leadId);
  const { data: doOrg = [], isLoading: catalogoCarregando } = useTags();
  const adicionar = useAddLeadTag();
  const remover = useRemoveLeadTag();
  const criar = useCreateTag();
  const registrar = useLogLeadAction();

  const [busca, setBusca] = useState("");

  /**
   * `tag` pode vir `null`. O embed `tags(...)` é filtrado pela RLS por conta
   * própria: se a linha de `lead_tags` é visível e a de `tags` não (etiqueta de
   * outra organização, apontada por um vínculo antigo), o PostgREST devolve o
   * vínculo com `tag: null` em vez de omitir a linha. Ler `p.tag.name` ali
   * derruba a coluna inteira do painel com um TypeError.
   */
  const presas = useMemo(() => presasBrutas.filter((p) => Boolean(p?.tag)), [presasBrutas]);

  const jaPresas = useMemo(() => new Set(presas.map((p) => p.tag_id)), [presas]);
  const termo = busca.trim();
  const alvo = dobrar(termo);

  const disponiveis = useMemo(() => {
    const livres = doOrg.filter((t) => !jaPresas.has(t.id));
    if (!alvo) return livres;
    return livres.filter((t) => dobrar(t.name).includes(alvo));
  }, [doOrg, jaPresas, alvo]);

  /**
   * "Criar" exige DUAS certezas, e a segunda é a que faltava: que o catálogo
   * já chegou. Com `useTags` ainda carregando, `doOrg` é `[]` — e um `[]` que
   * significa "não sei" é indistinguível de um que significa "não tem". Nesse
   * intervalo o botão se oferecia para criar uma etiqueta que já existe, e o
   * INSERT voltava 23505.
   */
  const nomeInedito =
    !catalogoCarregando && alvo.length > 0 && !doOrg.some((t) => dobrar(t.name) === alvo);

  /** O nome digitado é de uma etiqueta que ESTE lead já tem. */
  const jaNoLead = alvo.length > 0 && presas.some((p) => dobrar(p.tag!.name) === alvo);

  const gravando = adicionar.isPending || criar.isPending;

  const pendurar = async (tagId: string, nome: string) => {
    try {
      await adicionar.mutateAsync({ leadId, tagId });
      registrar({ leadId, action: "tag_added", description: `Etiqueta "${nome}" adicionada` });
      setBusca("");
      aoPendurar?.();
    } catch (erro) {
      toast.error(motivo(erro, "pendurar"));
    }
  };

  /**
   * São DUAS escritas, e a segunda pode falhar depois de a primeira ter dado
   * certo — a etiqueta passa a existir na organização sem estar no lead. Não há
   * transação a puxar daqui (são duas tabelas por PostgREST), então o que dá
   * para não errar é a FRASE: dizer "não foi possível criar" depois de criar
   * manda a pessoa tentar de novo e nascer uma etiqueta duplicada.
   */
  const criarEPendurar = async () => {
    if (!termo) return;
    let nova: { id: string } | null = null;
    try {
      // `organization_id` fica por conta do `useCreateTag`, que já resolve a org
      // do usuário. Repetir a consulta aqui seria uma segunda fonte para o mesmo
      // fato — e é assim que as duas verdades começam.
      nova = await criar.mutateAsync({ name: termo, color: corDoNome(termo) });
    } catch (erro) {
      toast.error(motivo(erro, "criar"));
      return;
    }
    try {
      await adicionar.mutateAsync({ leadId, tagId: nova.id });
      registrar({
        leadId,
        action: "tag_added",
        description: `Etiqueta "${termo}" criada e adicionada`,
      });
      setBusca("");
      aoPendurar?.();
    } catch (erro) {
      toast.error(
        `A etiqueta “${termo}” foi criada, mas não entrou neste lead. ${motivo(erro, "pendurar")}`,
      );
    }
  };

  const tirar = async (leadTagId: string, nome: string) => {
    try {
      const r = await remover.mutateAsync({ leadTagId, leadId });
      /**
       * Zero linhas NÃO é erro: é a etiqueta já ter saído por outra tela (o
       * painel do Chat apaga por `lead_id`+`tag_id` e não invalida esta chave).
       * A invalidação já rodou — a pílula fantasma some sozinha — e o que falta
       * é não acusar a pessoa de falta de permissão por um clique que só chegou
       * atrasado.
       */
      if (r && r.removidas === 0) {
        toast.info("Esta etiqueta já tinha sido removida.");
        return;
      }
      registrar({ leadId, action: "tag_removed", description: `Etiqueta "${nome}" removida` });
    } catch (erro) {
      toast.error(motivo(erro, "remover"));
    }
  };

  return {
    /** Etiquetas do lead, já sem os vínculos que a RLS devolveu cegos. */
    presas,
    /** Do catálogo da org, o que o lead ainda não tem — filtrado pela busca. */
    disponiveis,
    /** O catálogo inteiro. Serve para distinguir "não tem" de "não sei". */
    doOrg,
    busca,
    setBusca,
    termo,
    nomeInedito,
    jaNoLead,
    isLoading,
    catalogoCarregando,
    gravando,
    removendo: remover.isPending,
    pendurar,
    criarEPendurar,
    tirar,
  };
}

export type EditorDeEtiquetas = ReturnType<typeof useEditorDeEtiquetas>;
