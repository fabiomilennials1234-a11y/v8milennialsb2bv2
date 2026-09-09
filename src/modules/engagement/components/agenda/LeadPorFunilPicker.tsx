/**
 * O par Funil → Lead de uma reunião.
 *
 * Fluxo: escolher o funil, buscar dentro DELE, escolher o lead. Trocar o funil
 * limpa o lead — deixar o chip antigo sobreviver faria a tela afirmar um
 * vínculo que a próxima gravação desmentiria.
 *
 * É um componente e não código solto dentro do dialog porque CRIAR e EDITAR
 * reunião precisam do MESMO par. Duas cópias divergiriam na primeira correção
 * — foi assim que o seletor de lead antigo ficou preso aos primeiros 50 leads
 * enquanto o resto do app já buscava no servidor.
 *
 * DECISÃO DE UI — lista INLINE, não dropdown flutuante.
 *
 * O seletor anterior abria um `<div className="absolute">` por cima do
 * formulário e dependia de `onBlur` com `setTimeout(200ms)` brigando com
 * `onMouseDown` + `preventDefault` para o clique chegar antes do fechamento.
 * Isso já era frágil com dados síncronos; com busca no servidor vira corrida
 * (o resultado chega depois do blur). Pior: o `DialogContent` é
 * `overflow-y-auto`, e conteúdo absoluto que ultrapassa a caixa é CORTADO —
 * a mesma família de defeito que fez o botão de excluir da Agenda nascer fora
 * da tela.
 *
 * A lista inline empurra o formulário em vez de flutuar sobre ele: o dialog
 * rola sozinho, não há z-index, não há corrida de foco, e o teclado funciona
 * sem código nenhum. Custa altura; paga com previsibilidade.
 *
 * `<div>` com `overflow-y-auto` e não `<ScrollArea>` de propósito: o wrapper
 * de scroll do repo tem um defeito conhecido de rolagem dentro de superfícies
 * flutuantes, e aqui não há nada que ele resolva.
 */

import { useMemo, useState } from "react";
import { Loader2, Search, X, AlertCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/shared/hooks/useDebounce";
import { usePipelines, usePipelineDisplayConfig } from "@/modules/pipelines";
import { nomeDoFunil } from "@/contracts/pipe";
import { useLeadsPorFunil, useLeadById } from "@/modules/leads";
import type { EntradaDoFunil, LeadDoFunil } from "@/modules/leads";

/**
 * Sentinela do Select. Radix LEVANTA com `value=""` em `SelectItem`, então
 * "nenhum funil" precisa de um valor real. Mesma solução que o filtro de
 * responsável da própria Agenda já usa.
 */
export const SEM_FUNIL = "__sem_funil__";

/** 300ms — o mesmo dos outros dois campos de busca de lead do app. */
const DEBOUNCE_MS = 300;

/**
 * O que conta como "o negócio do lead" na hora de RESOLVER um vínculo sozinho.
 *
 * ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 * Antes, a candidata era só `!!e.deal_id`. Com uma candidata única o picker
 * resolvia sem UI nenhuma e gravava o `deal_id` — inclusive o de uma entrada
 * já ENCERRADA. Medido em prod 2026-09-04: de 38.811 pares (funil, lead) com
 * negócio, **2.046** resolviam para uma entrada fechada, e não havia nada na
 * tela dizendo isso. Reunião marcada hoje ia parar num card que ninguém abre
 * mais — e escrita de dado é o único defeito desta fatia que o rollback não
 * desfaz, porque ele não distingue o que uma pessoa vinculou à mão.
 *
 * ── A DEFINIÇÃO ESCOLHIDA: `closed_at IS NULL` DA ENTRADA ─────────────────
 * A fatia tinha TRÊS definições divergentes de "o negócio do lead":
 *
 *   • a migration `20270927000000` (backfill de `meetings.deal_id`):
 *     `pe.closed_at IS NULL`;
 *   • `supabase/functions/meeting-webhook`: `deals.outcome = 'open'`
 *     + `deals.deleted_at IS NULL`;
 *   • este picker: nenhuma.
 *
 * Este arquivo passa a usar a PRIMEIRA — `closed_at IS NULL` da entrada — por
 * três razões, nesta ordem:
 *
 *   1. **É a coluna da linha que recebe a escrita.** O que o par (funil, lead)
 *      resolve é uma ENTRADA, e é na `pipeline_entries.metadata` DELA que o
 *      trigger `trg_meeting_espelha_no_funil` projeta a reunião. A entrada é o
 *      card no board; `closed_at` é exatamente "este card saiu do board".
 *      Perguntar pelo desfecho do negócio é perguntar de outra tabela sobre um
 *      objeto que não é o que se escreve.
 *   2. **Empata com o outro resolvedor automático da fatia.** O backfill da
 *      migration é a única outra escrita que escolhe negócio SEM ninguém na
 *      frente da tela, e o livro `backup.meetings_deal_id_s6_20270927` (que o
 *      rollback consome) não sabe distinguir auto de manual. Duas regras
 *      diferentes para a mesma decisão produziriam linhas que parecem escolha
 *      humana e não são.
 *   3. **Custa zero.** `closed_at` já vem no `!inner` de `useLeadsPorFunil`.
 *      `deals.outcome` exigiria um embed novo em `deals` a cada tecla digitada
 *      no campo de busca.
 *
 * As duas definições discordam em 133 das 38.918 entradas com negócio (88
 * entradas abertas com negócio fechado, 45 fechadas com negócio aberto), o que
 * dá 133 pares — 0,34%. Não é indiferente, mas nenhuma das duas é "errada": o
 * que era errado era haver três.
 *
 * ⚠️ CONVERGÊNCIA PENDENTE, FORA DESTA FRENTE: o `meeting-webhook`
 * (`supabase/functions/meeting-webhook/index.ts`, na resolução do `deal_id`)
 * ainda pergunta por `deals.outcome`. Trocar por `.is('closed_at', null)` em
 * `pipeline_entries` alinharia os três caminhos; é mudança de edge function e
 * não foi feita aqui.
 *
 * Entrada SEM negócio continua fora por outro motivo, que não mudou: 19,2% das
 * entradas de prod têm `deal_id` nulo, e oferecer "escolha uma destas duas,
 * uma sem negócio" seria pedir uma decisão que não muda nada.
 *
 * O que este filtro NÃO faz: mexer num `dealId` que já chegou pelo `value`.
 * Reunião do backfill (ou do webhook) reaberta para edição preserva o vínculo
 * que tem, mesmo apontando para entrada fechada — o filtro governa o que se
 * resolve AGORA, nunca o que alguém já decidiu.
 *
 * NÃO é exportada de propósito. Exportar convidaria outro caminho a importá-la
 * e a divergir na primeira correção — que é exatamente como a fatia acabou com
 * três definições. Quem precisar da mesma regra em SQL a lê na migration; quem
 * precisar dela no cliente, aqui.
 */
function ehCandidata(entrada: EntradaDoFunil): boolean {
  return !!entrada.deal_id && entrada.closed_at === null;
}

export interface LeadPorFunilValue {
  pipelineId: string | null;
  leadId: string | null;
  /**
   * O NEGÓCIO da reunião — S6.
   *
   * Não é um terceiro campo que a pessoa preenche: sai da ENTRADA que o par
   * (funil, lead) já resolve, porque `uq_pipeline_entries_deal_id` faz negócio
   * e entrada serem 1:1. No caso normal sai sozinho ao escolher o lead; nos
   * poucos pares com mais de uma entrada ABERTA no mesmo funil (11 de 48.021
   * pares, medido em prod 2026-09-04) aparece o desempate abaixo e a pessoa
   * escolhe. O que é candidata está em `ehCandidata`, acima — e a resposta
   * mudou: entrada encerrada deixou de contar.
   *
   * Opcional no TIPO porque quem já grava só (funil, lead) — e não conhece
   * negócio nenhum — continua compilando. O `onChange` SEMPRE emite os três.
   */
  dealId?: string | null;
}

interface LeadPorFunilPickerProps {
  value: LeadPorFunilValue;
  onChange: (next: LeadPorFunilValue) => void;
  /** Trava os dois campos — usado enquanto a reunião ainda está carregando. */
  disabled?: boolean;
}

export function LeadPorFunilPicker({
  value,
  onChange,
  disabled = false,
}: LeadPorFunilPickerProps) {
  const { pipelineId, leadId } = value;
  const dealId = value.dealId ?? null;

  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebounce(busca, DEBOUNCE_MS);

  /**
   * As entradas concorrentes do lead escolhido — só existe no caso ambíguo.
   *
   * Mora em estado local, e não no `value`, porque é ANDAIME de escolha: some
   * quando o lead muda e nunca é gravado. Precisa sobreviver ao clique no lead
   * porque, escolhido o lead, a lista de onde as entradas vieram desaparece da
   * tela — sem guardá-las aqui o desempate não teria o que oferecer.
   *
   * Carrega o LEAD a que pertence, e não só o array: o mesmo picker é remontado
   * com outro `leadId` quando o diálogo de edição troca de reunião, e um empate
   * órfão do lead anterior ofereceria dois negócios de outra pessoa.
   */
  const [empate, setEmpate] = useState<{
    leadId: string;
    entradas: EntradaDoFunil[];
  } | null>(null);

  const entradasAmbiguas =
    empate && empate.leadId === leadId ? empate.entradas : [];

  const {
    data: funisRaw,
    isLoading: carregandoFunis,
    isError: erroFunis,
  } = usePipelines();
  const { data: displayConfig } = usePipelineDisplayConfig();

  /**
   * O NOME que a organização usa, que não é `pipelines.name`.
   *
   * A regra saiu daqui para `@/contracts/pipe` (`nomeDoFunil`) quando o
   * cadastro de lead precisou dela e não podia importar `pipelines` —
   * SCRUM-608. Era o único lugar do sistema que fazia o cruzamento certo, e
   * copiar seria garantir divergência na primeira correção.
   *
   * O que continua sendo desta tela: só a ligação com a query.
   */
  const nomearFunil = useMemo(
    () =>
      (funil: { name: string; slug?: string; type?: string }) =>
        nomeDoFunil(displayConfig, funil),
    [displayConfig],
  );

  /**
   * `usePipelines` NÃO filtra `is_active` — funil arquivado continua vindo. E
   * `SelectItem` com `value=""` faz o Radix levantar, então id vazio some da
   * lista em vez de derrubar a tela.
   *
   * ⚠️ Deliberadamente NÃO filtra `is_visible` do display config: esconder um
   * funil da navegação não tira os leads de dentro dele, e o pedido é que
   * TODOS os funis da organização apareçam. Esconder aqui deixaria lead
   * inalcançável.
   */
  const funis = useMemo(
    () => (funisRaw ?? []).filter((p) => !!p.id && p.is_active !== false),
    [funisRaw],
  );

  const funilSelecionado = useMemo(
    () => funis.find((p) => p.id === pipelineId) ?? null,
    [funis, pipelineId],
  );

  /**
   * O funil GRAVADO na reunião que não está mais na lista ativa.
   *
   * Sem isto o `<Select>` recebe um `value` que não casa com `SelectItem`
   * nenhum e o Radix cai no placeholder: a tela diria "Nenhum funil" numa
   * reunião que TEM funil gravado — negando um vínculo que está no banco, e
   * indistinguível de uma reunião realmente sem funil. Como a FK é
   * `ON DELETE SET NULL`, arquivar (`is_active=false`) não zera a coluna.
   */
  const funilArquivado = useMemo(() => {
    if (!pipelineId || funilSelecionado) return null;
    return (funisRaw ?? []).find((p) => p.id === pipelineId) ?? null;
  }, [funisRaw, funilSelecionado, pipelineId]);

  const {
    data: resultado,
    isFetching: buscandoLeads,
    isError: erroLeads,
    error: erroLeadsObj,
    refetch: refetchLeads,
  } = useLeadsPorFunil({ pipelineId, search: buscaDebounced });

  const leads = resultado?.leads ?? [];
  const temMais = resultado?.temMais ?? false;

  /**
   * O lead escolhido vem por id, não da lista: numa reunião reaberta ele pode
   * estar fora das 25 primeiras, ou ter saído do funil desde então. Resolver
   * pelo id é o que faz o chip mostrar o nome certo em vez de sumir.
   */
  const { data: leadEscolhido, isLoading: carregandoLead } = useLeadById(leadId);

  /**
   * 🚨 `dealId` morre junto com `leadId` nos TRÊS handlers.
   *
   * Um `dealId` sobrevivente de outro funil não deixa rastro na tela — o chip
   * some, o campo de negócio some, e o id continua no formulário. A reunião
   * seria gravada no card de um negócio que a pessoa nem estava olhando. É o
   * mesmo motivo pelo qual trocar o funil já limpava o lead.
   */
  const trocarFunil = (novo: string) => {
    const id = novo === SEM_FUNIL ? null : novo;
    setBusca("");
    setEmpate(null);
    // Limpa o lead SEMPRE que o funil muda — inclusive ao limpar o funil.
    onChange({ pipelineId: id, leadId: null, dealId: null });
  };

  const escolherLead = (lead: LeadDoFunil) => {
    setBusca("");

    const candidatas = (lead.entradas ?? []).filter(ehCandidata);

    if (candidatas.length === 1) {
      setEmpate(null);
      onChange({ pipelineId, leadId: lead.id, dealId: candidatas[0].deal_id });
      return;
    }

    if (candidatas.length > 1) {
      // Ambíguo: guarda as candidatas e deixa o negócio VAZIO. Pegar a primeira
      // (ou a mais recente, ou a de maior valor) é exatamente o que põe a
      // reunião no card errado sem ninguém perceber.
      setEmpate({ leadId: lead.id, entradas: candidatas });
      onChange({ pipelineId, leadId: lead.id, dealId: null });
      return;
    }

    // Nenhuma candidata — nem entrada sem negócio, nem entrada já encerrada,
    // servem. Segue SEM negócio, e isso não é falha: a reunião é o fato, o
    // negócio é o vínculo, e falta de vínculo nunca impede marcar reunião.
    // Preferir "sem negócio" a "negócio fechado" é a escolha inteira desta
    // função: um card mudo é recuperável à mão, um card errado ninguém vê.
    setEmpate(null);
    onChange({ pipelineId, leadId: lead.id, dealId: null });
  };

  const escolherEntrada = (entrada: EntradaDoFunil) => {
    onChange({ pipelineId, leadId, dealId: entrada.deal_id });
  };

  const limparLead = () => {
    setBusca("");
    setEmpate(null);
    onChange({ pipelineId, leadId: null, dealId: null });
  };

  return (
    <div className="space-y-4">
      {/* ── Funil ───────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Funil</Label>

        {erroFunis ? (
          <p className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Não foi possível carregar os funis.
          </p>
        ) : (
          <Select
            value={pipelineId ?? SEM_FUNIL}
            onValueChange={trocarFunil}
            disabled={disabled || carregandoFunis}
          >
            <SelectTrigger aria-label="Funil">
              <SelectValue
                placeholder={
                  carregandoFunis ? "Carregando funis..." : "Nenhum funil"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_FUNIL}>Nenhum funil</SelectItem>
              {funilArquivado && (
                <SelectItem value={funilArquivado.id}>
                  {nomearFunil(funilArquivado)} (arquivado)
                </SelectItem>
              )}
              {funis.map((funil) => (
                <SelectItem key={funil.id} value={funil.id}>
                  {nomearFunil(funil)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {!carregandoFunis && !erroFunis && funis.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            Esta organização ainda não tem funis.
          </p>
        )}
      </div>

      {/* ── Lead ────────────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Lead</Label>

        {leadId ? (
          /* Escolhido — chip com o nome resolvido pelo id. */
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {carregandoLead ? (
                <span className="text-muted-foreground">Carregando lead...</span>
              ) : leadEscolhido ? (
                <>
                  {leadEscolhido.name}
                  {leadEscolhido.company ? ` — ${leadEscolhido.company}` : ""}
                </>
              ) : (
                /* O lead saiu do ar (excluído, ou fora do alcance de quem
                   olha). Dizer isso é melhor do que mostrar um campo vazio
                   que parece "sem lead" quando há um id gravado. */
                <span className="text-muted-foreground">
                  Lead indisponível
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={limparLead}
              disabled={disabled}
              className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              Limpar
            </button>
          </div>
        ) : !pipelineId ? (
          /* Nenhum funil — o campo existe, explica o que falta e não mente
             oferecendo uma busca que não teria onde procurar. */
          <div className="rounded-lg border border-dashed border-border/40 px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              Escolha um funil acima para buscar os leads dele.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                className="pl-8"
                placeholder={`Buscar lead em ${
                  funilSelecionado ? nomearFunil(funilSelecionado) : "este funil"
                }...`}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                disabled={disabled}
                aria-label="Buscar lead no funil"
              />
              {buscandoLeads && (
                <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground/60" />
              )}
            </div>

            <ListaDeLeads
              leads={leads}
              temMais={temMais}
              buscando={buscandoLeads}
              erro={erroLeads}
              mensagemErro={(erroLeadsObj as Error | null)?.message}
              temTermo={!!buscaDebounced.trim()}
              onTentarDeNovo={() => void refetchLeads()}
              onEscolher={escolherLead}
              disabled={disabled}
            />
          </div>
        )}
      </div>

      {/* ── Negócio (só no empate) ──────────────────────────────────────────
          Terceiro seletor. NÃO aparece no caminho normal: lá o negócio saiu da
          única entrada do lead neste funil e mostrar um campo com uma opção só
          seria pedir confirmação de algo que não tem alternativa. */}
      {leadId && entradasAmbiguas.length > 1 && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Negócio</Label>
          <div className="overflow-hidden rounded-lg border border-amber-500/30">
            <p className="border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
              {/* "abertos" não é enfeite: a lista já não oferece entrada
                  encerrada, e dizer só "negócios" faria a pessoa procurar na
                  lista um negócio fechado que ela sabe que existe. */}
              Este lead tem {entradasAmbiguas.length} negócios abertos neste
              funil. Escolha em qual a reunião deve aparecer.
            </p>
            {entradasAmbiguas.map((entrada) => {
              const escolhida = entrada.deal_id === dealId;
              return (
                <button
                  key={entrada.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => escolherEntrada(entrada)}
                  className={`flex w-full flex-col items-start gap-0.5 border-b border-border/30 px-3 py-2 text-left transition-colors last:border-b-0 disabled:opacity-50 ${
                    escolhida ? "bg-primary/10" : "hover:bg-muted/40"
                  }`}
                >
                  <span className="w-full truncate text-xs text-foreground">
                    {/* `stage_name` vem do embed da própria entrada. Cair no
                        `stage_key` é degradação, não erro: 41 das 48.174
                        entradas de prod estão sem `stage_id` (etapa apagada) e
                        o slug ainda diz mais do que "—". */}
                    {entrada.stage_name ?? entrada.stage_key ?? "Sem etapa"}
                  </span>
                  <span className="w-full truncate text-[11px] text-muted-foreground">
                    {entrada.entered_at
                      ? `Entrou em ${new Date(entrada.entered_at).toLocaleDateString("pt-BR")}`
                      : "Sem data de entrada"}
                  </span>
                </button>
              );
            })}
          </div>
          {/* Não bloqueia o salvar: sem negócio a reunião existe do mesmo
              jeito, só não aparece no card. Bloquear trocaria "reunião sem
              vínculo" por "reunião nenhuma". */}
          {!dealId && (
            <p className="text-[11px] text-muted-foreground">
              Sem escolher, a reunião é criada sem negócio.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Lista ────────────────────────────────────────────────────────────────

interface ListaDeLeadsProps {
  leads: LeadDoFunil[];
  temMais: boolean;
  buscando: boolean;
  erro: boolean;
  mensagemErro?: string;
  temTermo: boolean;
  onTentarDeNovo: () => void;
  /**
   * Devolve o LEAD inteiro, não o id — S6. As entradas do lead neste funil só
   * existem nesta linha; devolver o id obrigaria a caçá-las de novo, e no
   * momento do clique elas já estão em mãos.
   */
  onEscolher: (lead: LeadDoFunil) => void;
  disabled: boolean;
}

function subtitulo(lead: ListaDeLeadsProps["leads"][number]): string | null {
  const partes = [lead.company, lead.phone || lead.email].filter(
    Boolean,
  ) as string[];
  return partes.length ? partes.join(" · ") : null;
}

function ListaDeLeads({
  leads,
  temMais,
  buscando,
  erro,
  mensagemErro,
  temTermo,
  onTentarDeNovo,
  onEscolher,
  disabled,
}: ListaDeLeadsProps) {
  if (erro) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
        <p className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Não foi possível carregar os leads deste funil.
            {mensagemErro ? ` (${mensagemErro})` : ""}
          </span>
        </p>
        <button
          type="button"
          onClick={onTentarDeNovo}
          className="mt-1.5 text-[11px] font-medium text-destructive underline underline-offset-2"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  // Spinner só quando não há NADA para mostrar. Enquanto a busca refaz sobre
  // uma lista já visível, trocar a lista por um spinner faria a tela piscar a
  // cada tecla.
  if (buscando && leads.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border/40 py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 px-3 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          {temTermo
            ? "Nenhum lead deste funil corresponde à busca."
            : "Este funil ainda não tem leads."}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/40">
      <div className="max-h-52 overflow-y-auto">
        {leads.map((lead) => {
          const sub = subtitulo(lead);
          return (
            <button
              key={lead.id}
              type="button"
              disabled={disabled}
              onClick={() => onEscolher(lead)}
              className="flex w-full flex-col items-start gap-0.5 border-b border-border/30 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/40 disabled:opacity-50"
            >
              <span className="w-full truncate text-xs text-foreground">
                {lead.name}
              </span>
              {sub && (
                <span className="w-full truncate text-[11px] text-muted-foreground">
                  {sub}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {temMais && (
        <p className="border-t border-border/30 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
          Mostrando os primeiros resultados — refine a busca para achar outros.
        </p>
      )}
    </div>
  );
}
