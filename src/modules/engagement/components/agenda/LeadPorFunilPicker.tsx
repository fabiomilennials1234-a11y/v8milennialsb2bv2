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

/**
 * Sentinela do Select. Radix LEVANTA com `value=""` em `SelectItem`, então
 * "nenhum funil" precisa de um valor real. Mesma solução que o filtro de
 * responsável da própria Agenda já usa.
 */
export const SEM_FUNIL = "__sem_funil__";

/** 300ms — o mesmo dos outros dois campos de busca de lead do app. */
const DEBOUNCE_MS = 300;

export interface LeadPorFunilValue {
  pipelineId: string | null;
  leadId: string | null;
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

  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebounce(busca, DEBOUNCE_MS);

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

  const trocarFunil = (novo: string) => {
    const id = novo === SEM_FUNIL ? null : novo;
    setBusca("");
    // Limpa o lead SEMPRE que o funil muda — inclusive ao limpar o funil.
    onChange({ pipelineId: id, leadId: null });
  };

  const escolherLead = (id: string) => {
    setBusca("");
    onChange({ pipelineId, leadId: id });
  };

  const limparLead = () => {
    setBusca("");
    onChange({ pipelineId, leadId: null });
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
    </div>
  );
}

// ─── Lista ────────────────────────────────────────────────────────────────

interface ListaDeLeadsProps {
  leads: Array<{
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
  }>;
  temMais: boolean;
  buscando: boolean;
  erro: boolean;
  mensagemErro?: string;
  temTermo: boolean;
  onTentarDeNovo: () => void;
  onEscolher: (id: string) => void;
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
              onClick={() => onEscolher(lead.id)}
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
