import { useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";

import { useCreateTag, useTags } from "../../hooks/useTags";
import {
  useAddLeadTag,
  useLeadTagsAttached,
  useRemoveLeadTag,
} from "../../hooks/lead/useLeadTagsAttached";

/**
 * A faixa de etiquetas do card do Lead — a que ESCREVE.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE, EM VEZ DE UM `onClick` NO CARD ───────────
 * O botão "+ etiqueta" já estava desenhado no `LeadCard` desde o começo, e era
 * um botão morto: `<button type="button">+ etiqueta</button>`, sem `onClick`,
 * sem `disabled`. A coluna do painel do Negócio (`LeadCardAside`) nem isso
 * tinha — só a pílula "sem etiqueta", que é um convite para uma porta que não
 * existe. Etiqueta virou o único campo do card que se lia e não se escrevia.
 *
 * O conserto não podia ser um `onClick` dentro do card porque os dois arquivos
 * de desenho — `LeadCard.tsx` e `LeadCardAside.tsx` — são alcançáveis a partir
 * de `src/preview/main.tsx`, e `preview-cards-sem-banco.test.ts` (inv:H5-17)
 * reprova qualquer arquivo daquele grafo que importe react-query/supabase-js,
 * ou que sequer escreva a palavra `supabase` fora de comentário. A rota abre
 * sem login: o que ela alcança, qualquer visitante alcança.
 *
 * O escape é o idioma da casa e já tem dois precedentes na mesma pasta:
 * `LeadCardControles` (qualificação e responsáveis) e `painelChecklists` no
 * card do Negócio. O card recebe o controle PRONTO como `ReactNode`; quem monta
 * é o `LeadCardContainer`, que o próprio teste exige estar FORA do grafo do
 * preview (`preview-cards-sem-banco.test.ts:186`).
 *
 * ── ETIQUETA É DO LEAD, E ISSO É ESCOLHA DO SCHEMA, NÃO DESTA TELA ────────
 * Não existe etiqueta de Negócio: a única junção é `lead_tags(lead_id, tag_id)`
 * e o catálogo `tags` é por organização. `deals`, `pipeline_entries` e
 * `custom_pipe_entries` não têm coluna de etiqueta. Etiquetar "dentro do
 * negócio" etiqueta a PESSOA dona dele — e portanto aparece nos outros negócios
 * dela, no filtro do quadro e no gatilho `tag_added` das automações. É o
 * comportamento correto hoje; mudá-lo seria migration, não componente.
 *
 * ── CRIAR ETIQUETA NOVA É SÓ DE ADMIN, E A RLS É QUEM DIZ ─────────────────
 * `lead_tags_insert_organization` deixa qualquer pessoa da org PENDURAR uma
 * etiqueta existente; `tags_insert_admin_only` exige `is_user_admin()` para
 * CRIAR uma. Por isso `podeCriar` chega por prop de quem já sabe a resposta,
 * em vez de este componente perguntar de novo em toda montagem. Quando ele é
 * falso, a linha "Criar" não aparece — e o erro da RLS ainda é traduzido,
 * porque `is_user_admin()` é a verdade e a prop é só uma previsão dela.
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
function dobrar(texto: string): string {
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
function motivo(erro: unknown, acao: "criar" | "pendurar" | "remover"): string {
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

export function LeadCardEtiquetas({
  leadId,
  podeCriar = false,
  className,
  alinhamento = "esquerda",
}: {
  leadId: string;
  /**
   * Oferece "Criar «nome»" quando a busca não casa com nenhuma etiqueta da org.
   * Só faz sentido para admin — ver o bloco de RLS no cabeçalho.
   */
  podeCriar?: boolean;
  className?: string;
  /** A coluna do painel do Negócio centraliza; o card inteiro alinha à esquerda. */
  alinhamento?: "esquerda" | "centro";
}) {
  const { data: presasBrutas = [], isLoading } = useLeadTagsAttached(leadId);
  const { data: doOrg = [], isLoading: catalogoCarregando } = useTags();
  const adicionar = useAddLeadTag();
  const remover = useRemoveLeadTag();
  const criar = useCreateTag();
  const registrar = useLogLeadAction();

  const [aberto, setAberto] = useState(false);
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
  const jaNoLead =
    alvo.length > 0 &&
    presas.some((p) => dobrar(p.tag.name) === alvo);

  const gravando = adicionar.isPending || criar.isPending;

  const fechar = () => {
    setAberto(false);
    setBusca("");
  };

  const pendurar = async (tagId: string, nome: string) => {
    try {
      await adicionar.mutateAsync({ leadId, tagId });
      registrar({ leadId, action: "tag_added", description: `Etiqueta "${nome}" adicionada` });
      fechar();
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
      registrar({ leadId, action: "tag_added", description: `Etiqueta "${termo}" criada e adicionada` });
      fechar();
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

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        alinhamento === "centro" ? "justify-center" : "justify-start",
        className,
      )}
    >
      {presas.map((p) => {
        /**
         * `color-mix` em vez de sufixo de alpha no hex (`#rrggbb` + `1f`).
         * `tags.color` é texto livre — o banco não valida nada — e "red1f" ou
         * "#abc1f" não são cor nenhuma: o navegador descarta a regra inteira e
         * a pílula perde também a borda. `color-mix` aceita qualquer cor CSS
         * válida. É o mesmo tratamento de `LeadCardLabels`, a pílula que o card
         * do quadro já desenha — 12% de tinta assenta em qualquer tema.
         */
        const cor = p.tag.color || "#888888";
        return (
          <span
            key={p.id}
            className="group inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11.5px]"
            style={{
              backgroundColor: `color-mix(in srgb, ${cor} 12%, transparent)`,
              borderColor: `color-mix(in srgb, ${cor} 24%, transparent)`,
              color: cor,
            }}
          >
            {p.tag.name}
            <button
              type="button"
              aria-label={`Remover a etiqueta ${p.tag.name}`}
              onClick={() => tirar(p.id, p.tag.name)}
              disabled={remover.isPending}
              className={cn(
                "-mr-0.5 rounded-full opacity-60 transition-opacity",
                "hover:opacity-100 focus-visible:opacity-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-30",
              )}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}

      {/* A pílula "sem etiqueta" continua existindo quando não há nenhuma: sumir
          a faixa vazia é o que faz ninguém nunca etiquetar. Ela some enquanto a
          leitura não voltou, para não piscar "sem etiqueta" num lead que tem. */}
      {presas.length === 0 && !isLoading && (
        <span className="inline-flex rounded-full border border-dashed border-border px-2.5 py-[3px] text-[11.5px] text-muted-foreground/70">
          sem etiqueta
        </span>
      )}

      <Popover
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          if (!v) setBusca("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={gravando}
            /* Rótulo explícito: o texto visível é só "etiqueta", e ao lado dele
               ficam os "Remover a etiqueta X" das pílulas. Sem isto, o botão que
               ADICIONA e os que REMOVEM se chamam quase igual para quem lê por
               leitor de tela — e para quem procura por nome no teste. */
            aria-label="Adicionar etiqueta"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-[3px] text-[11.5px] text-muted-foreground",
              "transition-colors hover:border-muted-foreground/40 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            {gravando ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3" />
            )}
            etiqueta
          </button>
        </PopoverTrigger>

        {/* O conteúdo do Popover do Radix tem `role="dialog"`, e diálogo sem
            nome é anunciado como "dialog" e mais nada. */}
        <PopoverContent align="start" aria-label="Escolher etiqueta" className="w-60 space-y-2 p-2">
          <Input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar etiqueta…"
            className="h-7 text-xs"
          />

          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {disponiveis.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pendurar(t.id, t.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                  "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color || "#888888" }}
                  aria-hidden="true"
                />
                <span className="truncate">{t.name}</span>
              </button>
            ))}

            {/* Cada vazio diz uma coisa diferente, e confundi-los é o que faz a
                pessoa concluir que a busca está quebrada. */}
            {disponiveis.length === 0 && !nomeInedito && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground/60">
                {catalogoCarregando
                  ? "Carregando etiquetas…"
                  : jaNoLead
                    ? "Esta etiqueta já está no lead."
                    : doOrg.length === 0
                      ? "Nenhuma etiqueta cadastrada nesta organização."
                      : "Nenhuma etiqueta disponível."}
              </p>
            )}
          </div>

          {nomeInedito &&
            (podeCriar ? (
              <button
                type="button"
                onClick={criarEPendurar}
                disabled={gravando}
                className={cn(
                  "flex w-full items-center gap-2 rounded border border-dashed border-border px-2 py-1.5 text-left text-xs",
                  "transition-colors hover:border-muted-foreground/40 hover:bg-muted/50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-45",
                )}
              >
                <Plus className="size-3 shrink-0" />
                <span className="truncate">Criar “{termo}”</span>
              </button>
            ) : (
              /* Sem poder criar, dizer O PORQUÊ vale mais que sumir: quem digitou
                 um nome que não existe fica sabendo onde ele nasce, em vez de
                 concluir que a busca está quebrada. */
              <p className="px-2 pb-1 text-[11px] leading-snug text-muted-foreground/60">
                “{termo}” não existe. Etiquetas novas são criadas por um
                administrador em Configurações › Tags.
              </p>
            ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
