import { useState } from "react";
import { BarChart2, DollarSign, Target, Loader2, TrendingUp, ChevronDown, Calendar, FileEdit, Settings2, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCampanhas,
  useUpdateCampanha,
  useUpdateCampanhaMktConfig,
  type Campanha,
} from "@/hooks/useCampanhas";
import { usePipeConfirmacao } from "@/hooks/usePipeConfirmacao";
import { usePipePropostas } from "@/hooks/usePipePropostas";
import { useTags } from "@/hooks/useTags";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MktCalCard } from "@/components/marketing/MktCalCard";
import { MktCadastroCard } from "@/components/marketing/MktCadastroCard";
import { MktCampanhaConfigModal } from "@/components/marketing/MktCampanhaConfigModal";
import { toast } from "sonner";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Converte centavos para reais */
function centsToReais(cents: number | null | undefined): number {
  if (cents == null) return 0;
  return cents / 100;
}

/** Converte reais para centavos */
function reaisToCents(reais: number): number {
  return Math.round(reais * 100);
}

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export default function Marketing() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [configCampanha, setConfigCampanha] = useState<Campanha | null>(null);
  const [popoverOpen, setPopoverOpen] = useState<string | null>(null);

  const { data: campanhas = [], isLoading: loadingCampanhas } = useCampanhas();
  const { data: confirmacoes = [], isLoading: loadingConfirmacao } = usePipeConfirmacao();
  const { data: propostas = [], isLoading: loadingPropostas } = usePipePropostas();
  const { data: tags = [] } = useTags();
  const updateCampanha = useUpdateCampanha();
  const updateMktConfig = useUpdateCampanhaMktConfig();

  const campanhasNaoVinculadas = campanhas.filter((c) => c.mkt_ativo !== true);
  const campanhasVinculadas = campanhas.filter((c) => c.mkt_ativo === true);
  const hasCall = campanhasVinculadas.some((c) => c.mkt_incluir_call !== false);
  const hasCadastro = campanhasVinculadas.some((c) => c.mkt_incluir_cadastro !== false);

  const totalInvestimentoCents = campanhasVinculadas.reduce(
    (sum, c) =>
      sum + (c.mkt_investimento_call_cents ?? 0) + (c.mkt_investimento_cadastro_cents ?? 0),
    0
  );
  const totalInvestimentoReais = centsToReais(totalInvestimentoCents);

  const agendamentos = confirmacoes;
  const comparecimentos = confirmacoes.filter((c) => c.status === "compareceu");
  const vendas = propostas.filter((p) => p.status === "vendido");
  const custoPorReuniao =
    agendamentos.length > 0 ? totalInvestimentoReais / agendamentos.length : 0;
  const custoPorReuniaoComparecida =
    comparecimentos.length > 0 ? totalInvestimentoReais / comparecimentos.length : 0;
  const custoPorVenda = vendas.length > 0 ? totalInvestimentoReais / vendas.length : 0;

  const handleAdicionarAoMarketing = async (c: Campanha) => {
    try {
      await updateCampanha.mutateAsync({ id: c.id, mkt_ativo: true });
      toast.success(`${c.name} adicionada ao marketing`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao adicionar";
      toast.error(message);
    }
  };

  const handleRemoverDoMarketing = async (c: Campanha) => {
    try {
      await updateCampanha.mutateAsync({ id: c.id, mkt_ativo: false });
      toast.success(`${c.name} removida do marketing`);
      setPopoverOpen(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao remover";
      toast.error(message);
    }
  };

  const handleSaveMktConfig = async (payload: {
    id: string;
    mkt_investimento_call_cents: number | null;
    mkt_investimento_cadastro_cents: number | null;
    mkt_call_origins: string[] | null;
    mkt_call_tag_ids: string[] | null;
    mkt_cadastro_origins: string[] | null;
    mkt_cadastro_tag_ids: string[] | null;
    mkt_incluir_call: boolean | null;
    mkt_incluir_cadastro: boolean | null;
  }) => {
    try {
      await updateMktConfig.mutateAsync({
        id: payload.id,
        mkt_investimento_call_cents: payload.mkt_investimento_call_cents ?? null,
        mkt_investimento_cadastro_cents: payload.mkt_investimento_cadastro_cents ?? null,
        mkt_call_origins: payload.mkt_call_origins ?? null,
        mkt_call_tag_ids: payload.mkt_call_tag_ids ?? null,
        mkt_cadastro_origins: payload.mkt_cadastro_origins ?? null,
        mkt_cadastro_tag_ids: payload.mkt_cadastro_tag_ids ?? null,
        mkt_incluir_call: payload.mkt_incluir_call ?? true,
        mkt_incluir_cadastro: payload.mkt_incluir_cadastro ?? true,
      });
      toast.success("Configuração salva");
      setConfigCampanha(null);
      setPopoverOpen(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erro ao salvar configuração";
      toast.error(message);
    }
  };

  const isLoading =
    loadingCampanhas || loadingConfirmacao || loadingPropostas;

  const years = [2024, 2025, 2026, 2027];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary" />
            Marketing
          </h1>
          <p className="text-muted-foreground">
            Indicadores de investimento e custo por reunião/venda. Na divisão por campanha, configure por origem ou etiqueta quais leads contam para cada tipo (Call / Cadastro).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={selectedMonth.toString()}
            onValueChange={(v) => setSelectedMonth(Number(v))}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((label, index) => (
                <SelectItem key={index} value={(index + 1).toString()}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={selectedYear.toString()}
            onValueChange={(v) => setSelectedYear(Number(v))}
          >
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y.toString()}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Investimento total + custos */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <DollarSign className="w-4 h-4" />
                  Investimento total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(totalInvestimentoReais)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  Custo por reunião
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(custoPorReuniao)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  reuniões marcadas (inclui no-show)
                </p>
                <p className="text-xs text-muted-foreground">{agendamentos.length} agendamentos</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <Target className="w-4 h-4" />
                  Custo por reunião comparecida
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(custoPorReuniaoComparecida)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  só quem compareceu
                </p>
                <p className="text-xs text-muted-foreground">{comparecimentos.length} comparecimentos</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                  <TrendingUp className="w-4 h-4" />
                  Custo por venda
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(custoPorVenda)}</p>
                <p className="text-xs text-muted-foreground mt-1">{vendas.length} vendas</p>
              </CardContent>
            </Card>
          </div>

          {/* Selecionar campanhas para marketing */}
          <Card>
            <CardHeader>
              <CardTitle>Selecionar campanhas para marketing</CardTitle>
              <p className="text-sm text-muted-foreground font-normal">
                Adicione as campanhas que devem aparecer na divisão e poder ser configuradas (investimento, tipo, origem e etiqueta).
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {campanhasNaoVinculadas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {campanhas.length === 0 ? "Nenhuma campanha." : "Todas as campanhas já estão no marketing."}
                  </p>
                ) : (
                  campanhasNaoVinculadas.map((c) => (
                    <Button
                      key={c.id}
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => handleAdicionarAoMarketing(c)}
                    >
                      <Plus className="w-4 h-4" />
                      {c.name}
                    </Button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Divisão por campanha: só as vinculadas (botões segmentados) */}
          <Card>
            <CardHeader>
              <CardTitle>Divisão por campanha</CardTitle>
              <p className="text-sm text-muted-foreground font-normal">
                Clique na campanha para ver o desempenho; use a seta para abrir configuração (investimento, tipo de marketing, origem e etiqueta).
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {campanhasVinculadas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma campanha selecionada. Adicione acima.</p>
                ) : (
                  campanhasVinculadas.map((c) => (
                    <div
                      key={c.id}
                      className="inline-flex -space-x-px divide-x divide-border rounded-lg border border-border bg-background shadow-sm shadow-black/5 rtl:space-x-reverse w-full max-w-2xl"
                    >
                      <Button
                        size="icon"
                        variant="outline"
                        className="rounded-none border-0 shadow-none rounded-l-lg focus-visible:z-10 shrink-0 h-10 w-10"
                        aria-label="Configurar campanha"
                        onClick={() => setConfigCampanha(c)}
                      >
                        <Settings2 className="w-4 h-4" aria-hidden />
                      </Button>
                      <Popover open={popoverOpen === c.id} onOpenChange={(open) => setPopoverOpen(open ? c.id : null)}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="flex-1 justify-start gap-2 rounded-none border-0 shadow-none rounded-r-lg focus-visible:z-10 h-auto min-h-10 py-2 px-4 text-left font-medium"
                          >
                            <span className="truncate">{c.name}</span>
                            <span className="text-muted-foreground text-xs shrink-0">
                              {c.mkt_incluir_call !== false && (
                                <>Call: {c.mkt_investimento_call_cents != null ? formatCurrency(centsToReais(c.mkt_investimento_call_cents)) : "—"}</>
                              )}
                              {c.mkt_incluir_call !== false && c.mkt_incluir_cadastro !== false && " · "}
                              {c.mkt_incluir_cadastro !== false && (
                                <>Cad: {c.mkt_investimento_cadastro_cents != null ? formatCurrency(centsToReais(c.mkt_investimento_cadastro_cents)) : "—"}</>
                              )}
                              {c.mkt_incluir_call === false && c.mkt_incluir_cadastro === false && "—"}
                            </span>
                            {c.mkt_incluir_call !== false && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary shrink-0">
                                <Calendar className="w-2.5 h-2.5" />
                                Call
                              </span>
                            )}
                            {c.mkt_incluir_cadastro !== false && (
                              <span className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0">
                                <FileEdit className="w-2.5 h-2.5" />
                                Cadastro
                              </span>
                            )}
                            {c.mkt_incluir_call === false && c.mkt_incluir_cadastro === false && (
                              <span className="text-[10px] text-muted-foreground shrink-0">Nenhum tipo</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-72">
                          <div className="space-y-3">
                            <p className="font-medium text-sm">{c.name}</p>
                            <div className="text-xs text-muted-foreground space-y-1">
                              {c.mkt_incluir_call !== false && (
                                <p>
                                  <span className="font-medium text-foreground">Investimento Call:</span>{" "}
                                  {c.mkt_investimento_call_cents != null
                                    ? formatCurrency(centsToReais(c.mkt_investimento_call_cents))
                                    : "—"}
                                </p>
                              )}
                              {c.mkt_incluir_cadastro !== false && (
                                <p>
                                  <span className="font-medium text-foreground">Investimento Cadastro:</span>{" "}
                                  {c.mkt_investimento_cadastro_cents != null
                                    ? formatCurrency(centsToReais(c.mkt_investimento_cadastro_cents))
                                    : "—"}
                                </p>
                              )}
                              <p>
                                <span className="font-medium text-foreground">Tipo:</span>{" "}
                                {c.mkt_incluir_call !== false && c.mkt_incluir_cadastro !== false
                                  ? "Call e Cadastro"
                                  : c.mkt_incluir_call !== false
                                    ? "Call"
                                    : c.mkt_incluir_cadastro !== false
                                      ? "Cadastro"
                                      : "Nenhum"}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              className="w-full gap-2"
                              onClick={() => {
                                setPopoverOpen(null);
                                setConfigCampanha(c);
                              }}
                            >
                              <ChevronDown className="w-4 h-4" />
                              Configurar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="w-full gap-2 text-muted-foreground"
                              onClick={() => handleRemoverDoMarketing(c)}
                            >
                              <X className="w-4 h-4" />
                              Remover do marketing
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <MktCampanhaConfigModal
            open={!!configCampanha}
            onOpenChange={(open) => !open && setConfigCampanha(null)}
            campanha={configCampanha}
            tags={tags}
            onSave={handleSaveMktConfig}
          />

          {/* Cards MKT Cal e MKT Cadastro — só os tipos em uso */}
          <div className={hasCall && hasCadastro ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : "space-y-4"}>
            {hasCall && <MktCalCard month={selectedMonth} year={selectedYear} />}
            {hasCadastro && <MktCadastroCard month={selectedMonth} year={selectedYear} />}
            {!hasCall && !hasCadastro && campanhasVinculadas.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Configure o tipo de marketing (Call e/ou Cadastro) nas campanhas acima para ver os dashboards.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
