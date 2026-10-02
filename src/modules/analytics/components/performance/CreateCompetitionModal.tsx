import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Check, ArrowLeft, ArrowRight, Plus, X, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCreateCompetition, useSaveCompetitionEdits, type Competition } from "@/modules/engagement/hooks/useCompetitions";
import { useTeamMembers } from "@/modules/identity";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente → modo edição (prefila o wizard e salva alterações) */
  competition?: Competition | null;
  /** team_member_ids atuais da competição (para diff em edição) */
  existingParticipants?: string[];
  /** prêmios atuais da competição (para prefill em edição) */
  existingPrizes?: Array<{ position: number; prize_name: string; prize_value: number | null; prize_icon: string }>;
}

interface PrizeInput {
  position: number;
  prize_name: string;
  prize_value: string;
  prize_icon: string;
}

const DEFAULT_PRIZES: PrizeInput[] = [
  { position: 1, prize_name: "", prize_value: "", prize_icon: "🏆" },
  { position: 2, prize_name: "", prize_value: "", prize_icon: "🎁" },
  { position: 3, prize_name: "", prize_value: "", prize_icon: "🎧" },
];

// `EMOJIS` é o seletor do ÍCONE DO PRÊMIO — vira `prize_icon` no banco e o
// pódio o desenha. É dado do usuário, não cópia: fica como está.
const EMOJIS = ["🏆", "🎁", "🎧", "📱", "💰", "🎯", "⭐", "🔥"];
// V5: a colocação era medalha-emoji; agora é chip numerado nas cores do pódio
// (ouro = primary, prata = silver, bronze = warning).
const PRIZE_POSITION_TONE = [
  "bg-primary text-primary-foreground",
  "bg-silver text-silver-foreground",
  "bg-warning text-warning-foreground",
  "bg-muted text-muted-foreground",
  "bg-muted text-muted-foreground",
];
const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const optionClass = (active: boolean) =>
  cn(
    "rounded-2xl border p-3 text-left text-sm transition-colors",
    active
      ? "border-primary/50 bg-primary-soft font-semibold text-primary-soft-foreground"
      : "border-border hover:bg-muted/50",
  );
const STEPS = ["Básico", "Participantes", "Prêmios", "Confirmação"];

export function CreateCompetitionModal({ open, onOpenChange, competition, existingParticipants, existingPrizes }: Props) {
  const isEdit = !!competition;
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<"absolute_value" | "goal_percentage">("absolute_value");
  const [metricType, setMetricType] = useState<"sales" | "meetings">("sales");
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [prizes, setPrizes] = useState<PrizeInput[]>(DEFAULT_PRIZES);

  const { data: teamMembers = [] } = useTeamMembers();
  const avatarMap = useAvatarMap();
  const createCompetition = useCreateCompetition();
  const saveEdits = useSaveCompetitionEdits();

  // Prefill quando abre em modo edição
  useEffect(() => {
    if (open && competition) {
      setStep(0);
      setName(competition.name);
      setDescription(competition.description ?? "");
      setCriteria(competition.criteria);
      setMetricType(competition.metric_type);
      setMonth(competition.month);
      setYear(competition.year);
      setSelectedMembers(new Set(existingParticipants ?? []));
      setPrizes(
        existingPrizes && existingPrizes.length > 0
          ? [...existingPrizes]
              .sort((a, b) => a.position - b.position)
              .map((p) => ({
                position: p.position,
                prize_name: p.prize_name,
                prize_value: p.prize_value != null ? String(p.prize_value) : "",
                prize_icon: p.prize_icon || "🏆",
              }))
          : DEFAULT_PRIZES,
      );
    }
  }, [open, competition, existingParticipants, existingPrizes]);

  /**
   * Elegibilidade de participantes:
   * - Apenas membros ativos
   * - metric_type deve corresponder ao tipo da competição
   * - Se metric_type for null (dado legado), aplica fallback consistente
   *   com a migration (DEFAULT 'meetings')
   *
   * Alinhado com: Performance.tsx (seed/ranking), useDashboardMetrics,
   * Comissoes.tsx — todos usam metric_type como critério único.
   */
  const getEffectiveMetricType = (member: any): string =>
    member.metric_type ?? "meetings";

  const filteredMembers = teamMembers.filter(
    (m: any) => m.is_active && getEffectiveMetricType(m) === metricType
  );

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedMembers.size === filteredMembers.length) {
      setSelectedMembers(new Set());
    } else {
      setSelectedMembers(new Set(filteredMembers.map((m: any) => m.id)));
    }
  };

  const addPrize = () => {
    if (prizes.length >= 5) return;
    setPrizes([...prizes, { position: prizes.length + 1, prize_name: "", prize_value: "", prize_icon: "🏅" }]);
  };

  const removePrize = (idx: number) => {
    const updated = prizes.filter((_, i) => i !== idx).map((p, i) => ({ ...p, position: i + 1 }));
    setPrizes(updated);
  };

  const updatePrize = (idx: number, field: keyof PrizeInput, value: string) => {
    const updated = [...prizes];
    updated[idx] = { ...updated[idx], [field]: value };
    setPrizes(updated);
  };

  const canNext = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return selectedMembers.size > 0;
    return true;
  };

  const handleSubmit = async (status: "draft" | "active") => {
    const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();

    try {
      await createCompetition.mutateAsync({
        name,
        description: description || undefined,
        criteria,
        metric_type: metricType,
        month,
        year,
        start_date: startDate,
        end_date: endDate,
        status,
        participants: Array.from(selectedMembers),
        prizes: prizes.filter((p) => p.prize_name.trim()).map((p) => ({
          position: p.position,
          prize_name: p.prize_name,
          prize_value: p.prize_value ? parseFloat(p.prize_value) : undefined,
          prize_icon: p.prize_icon,
        })),
      });

      toast.success(status === "active" ? "Competição criada e ativada!" : "Competição salva como rascunho.");
      handleClose();
    } catch (err: any) {
      toast.error("Erro ao criar competição: " + (err?.message || ""));
    }
  };

  const handleSaveEdit = async () => {
    if (!competition) return;
    const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString();

    try {
      await saveEdits.mutateAsync({
        id: competition.id,
        name,
        description: description || undefined,
        criteria,
        metric_type: metricType,
        month,
        year,
        start_date: startDate,
        end_date: endDate,
        participants: Array.from(selectedMembers),
        existingParticipants: existingParticipants ?? [],
        prizes: prizes.filter((p) => p.prize_name.trim()).map((p) => ({
          position: p.position,
          prize_name: p.prize_name,
          prize_value: p.prize_value ? parseFloat(p.prize_value) : undefined,
          prize_icon: p.prize_icon,
        })),
      });

      toast.success("Competição atualizada!");
      handleClose();
    } catch (err: any) {
      toast.error("Erro ao salvar competição: " + (err?.message || ""));
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep(0);
      setName("");
      setDescription("");
      setCriteria("absolute_value");
      setMetricType("sales");
      setMonth(now.getMonth() + 1);
      setYear(now.getFullYear());
      setSelectedMembers(new Set());
      setPrizes(DEFAULT_PRIZES);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
              <Trophy className="h-4 w-4" strokeWidth={2.2} />
            </span>
            {isEdit ? "Editar Competição" : "Nova Competição"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold tabular-nums transition-colors ${
                i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>{i + 1}</div>
              <span className={`text-xs hidden sm:inline ${i <= step ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 rounded-full ${i < step ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 0: Básico */}
          {step === 0 && (
            <motion.div key="step0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div>
                <Label>Nome da competição *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Corrida de Vendas Março" />
              </div>
              <div>
                <Label>Descrição</Label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opcional" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Mês</Label>
                  <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={SELECT_CLASS}>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{new Date(2026, i).toLocaleString("pt-BR", { month: "long" })}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Ano</Label>
                  <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
                </div>
              </div>
              <div>
                <Label>Critério de ranking</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(["absolute_value", "goal_percentage"] as const).map((c) => (
                    <button key={c} type="button" aria-pressed={criteria === c} onClick={() => setCriteria(c)} className={optionClass(criteria === c)}>
                      {c === "absolute_value" ? "Valor absoluto (R$)" : "% da meta individual"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Tipo</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(["sales", "meetings"] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={metricType === t} onClick={() => { setMetricType(t); setSelectedMembers(new Set()); }} className={optionClass(metricType === t)}>
                      {t === "sales" ? "Vendas" : "Reuniões"}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 1: Participantes */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              {filteredMembers.length > 0 ? (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm tabular-nums text-muted-foreground">{selectedMembers.size} de {filteredMembers.length} selecionados</p>
                    <Button variant="outline" size="sm" onClick={toggleAll}>
                      {selectedMembers.size === filteredMembers.length ? "Desmarcar todos" : "Selecionar todos"}
                    </Button>
                  </div>
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {filteredMembers.map((member: any) => (
                      <button
                        key={member.id}
                        onClick={() => toggleMember(member.id)}
                        type="button"
                        aria-pressed={selectedMembers.has(member.id)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-2xl border transition-colors ${
                          selectedMembers.has(member.id) ? "border-primary/50 bg-primary-soft" : "border-transparent hover:bg-muted/50"
                        }`}
                      >
                        <div className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center ${selectedMembers.has(member.id) ? "border-primary bg-primary" : "border-border"}`}>
                          {selectedMembers.has(member.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                        </div>
                        <UserAvatar name={member.name} avatarUrl={avatarMap.get(member.id)} size="sm" />
                        <div className="flex-1 text-left">
                          <p className="text-sm font-semibold">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.job_title || (getEffectiveMetricType(member) === "sales" ? "Vendas" : "Reuniões")}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
                    <AlertCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Nenhum membro elegível</p>
                    <p className="text-[13px] text-muted-foreground mt-1 max-w-[300px]">
                      Não há membros ativos com tipo de métrica "{metricType === "sales" ? "Vendas" : "Reuniões"}".
                      Verifique na página de Equipe se os membros têm o tipo de métrica correto configurado.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Step 2: Prêmios */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
              {prizes.map((prize, idx) => (
                <div key={idx} className="flex items-start gap-2.5 rounded-2xl bg-sunken p-3">
                  <span className={cn("mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold tabular-nums", PRIZE_POSITION_TONE[idx] ?? PRIZE_POSITION_TONE[3])}>
                    {idx + 1}º
                  </span>
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <div className="flex gap-1">
                        {EMOJIS.map((e) => (
                          <button key={e} type="button" aria-pressed={prize.prize_icon === e} onClick={() => updatePrize(idx, "prize_icon", e)} className={`w-7 h-7 rounded-lg text-sm transition-colors ${prize.prize_icon === e ? "bg-primary-soft ring-1 ring-primary" : "hover:bg-muted"}`}>{e}</button>
                        ))}
                      </div>
                    </div>
                    <Input value={prize.prize_name} onChange={(e) => updatePrize(idx, "prize_name", e.target.value)} placeholder={`Prêmio do ${idx + 1}º lugar`} />
                    <Input value={prize.prize_value} onChange={(e) => updatePrize(idx, "prize_value", e.target.value)} placeholder="Valor em R$ (opcional)" type="number" />
                  </div>
                  {prizes.length > 0 && (
                    <button type="button" aria-label={`Remover prêmio do ${idx + 1}º lugar`} onClick={() => removePrize(idx)} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><X className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              {prizes.length < 5 && (
                <Button variant="outline" size="sm" onClick={addPrize} className="w-full">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar posição
                </Button>
              )}
              <p className="text-[13px] text-muted-foreground">Prêmios são opcionais. Você pode criar uma competição apenas pelo ranking.</p>
            </motion.div>
          )}

          {/* Step 3: Confirmação */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="rounded-2xl bg-sunken p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
                    <Trophy className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <h3 className="text-[15px] font-bold tracking-[-0.02em]">{name}</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Período:</span> {new Date(year, month - 1).toLocaleString("pt-BR", { month: "long", year: "numeric" })}</div>
                  <div><span className="text-muted-foreground">Critério:</span> {criteria === "absolute_value" ? "Valor absoluto" : "% da meta"}</div>
                  <div><span className="text-muted-foreground">Tipo:</span> {metricType === "sales" ? "Vendas" : "Reuniões"}</div>
                  <div><span className="text-muted-foreground">Participantes:</span> {selectedMembers.size}</div>
                </div>
                {prizes.filter((p) => p.prize_name.trim()).length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Prêmios</p>
                    {prizes.filter((p) => p.prize_name.trim()).map((p) => (
                      <div key={p.position} className="flex items-center gap-2 text-sm">
                        <span>{p.prize_icon}</span>
                        <span>{p.position}º — {p.prize_name}</span>
                        {p.prize_value && <span className="tabular-nums text-muted-foreground">R$ {Number(p.prize_value).toLocaleString("pt-BR")}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft className="w-4 h-4 mr-1" /> Voltar</Button>
          ) : <div />}

          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>Próximo <ArrowRight className="w-4 h-4 ml-1" /></Button>
          ) : isEdit ? (
            <Button onClick={handleSaveEdit} disabled={saveEdits.isPending}>Salvar alterações</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => handleSubmit("draft")} disabled={createCompetition.isPending}>Rascunho</Button>
              <Button onClick={() => handleSubmit("active")} disabled={createCompetition.isPending}>Criar e ativar</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
