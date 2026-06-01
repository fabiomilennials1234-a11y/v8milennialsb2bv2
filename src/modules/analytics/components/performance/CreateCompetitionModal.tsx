import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Check, ArrowLeft, ArrowRight, Plus, X, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCreateCompetition } from "@/modules/engagement/hooks/useCompetitions";
import { useTeamMembers } from "@/modules/identity";
import { useAvatarMap } from "@/modules/identity/hooks/useAvatarMap";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PrizeInput {
  position: number;
  prize_name: string;
  prize_value: string;
  prize_icon: string;
}

const EMOJIS = ["🏆", "🎁", "🎧", "📱", "💰", "🎯", "⭐", "🔥"];
const MEDAL_EMOJIS = ["🥇", "🥈", "🥉", "🏅", "🏅"];
const STEPS = ["Básico", "Participantes", "Prêmios", "Confirmação"];

export function CreateCompetitionModal({ open, onOpenChange }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<"absolute_value" | "goal_percentage">("absolute_value");
  const [metricType, setMetricType] = useState<"sales" | "meetings">("sales");
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [prizes, setPrizes] = useState<PrizeInput[]>([
    { position: 1, prize_name: "", prize_value: "", prize_icon: "🏆" },
    { position: 2, prize_name: "", prize_value: "", prize_icon: "🎁" },
    { position: 3, prize_name: "", prize_value: "", prize_icon: "🎧" },
  ]);

  const { data: teamMembers = [] } = useTeamMembers();
  const avatarMap = useAvatarMap();
  const createCompetition = useCreateCompetition();

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

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => {
      setStep(0);
      setName("");
      setDescription("");
      setSelectedMembers(new Set());
      setPrizes([
        { position: 1, prize_name: "", prize_value: "", prize_icon: "🏆" },
        { position: 2, prize_name: "", prize_value: "", prize_icon: "🎁" },
        { position: 3, prize_name: "", prize_value: "", prize_icon: "🎧" },
      ]);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" />
            Nova Competição
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>{i + 1}</div>
              <span className={`text-xs hidden sm:inline ${i <= step ? "text-foreground" : "text-muted-foreground"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${i < step ? "bg-primary" : "bg-muted"}`} />}
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
                  <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
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
                    <button key={c} onClick={() => setCriteria(c)} className={`p-3 rounded-lg border text-sm text-left transition-colors ${criteria === c ? "border-primary bg-primary/5 font-medium" : "border-border"}`}>
                      {c === "absolute_value" ? "Valor absoluto (R$)" : "% da meta individual"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Tipo</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {(["sales", "meetings"] as const).map((t) => (
                    <button key={t} onClick={() => { setMetricType(t); setSelectedMembers(new Set()); }} className={`p-3 rounded-lg border text-sm text-left transition-colors ${metricType === t ? "border-primary bg-primary/5 font-medium" : "border-border"}`}>
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
                    <p className="text-sm text-muted-foreground">{selectedMembers.size} de {filteredMembers.length} selecionados</p>
                    <Button variant="outline" size="sm" onClick={toggleAll}>
                      {selectedMembers.size === filteredMembers.length ? "Desmarcar todos" : "Selecionar todos"}
                    </Button>
                  </div>
                  <div className="space-y-1 max-h-[300px] overflow-y-auto">
                    {filteredMembers.map((member: any) => (
                      <button
                        key={member.id}
                        onClick={() => toggleMember(member.id)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                          selectedMembers.has(member.id) ? "border-primary bg-primary/5" : "border-border/30"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${selectedMembers.has(member.id) ? "border-primary bg-primary" : "border-muted"}`}>
                          {selectedMembers.has(member.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                        </div>
                        <UserAvatar name={member.name} avatarUrl={avatarMap.get(member.id)} size="sm" />
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.job_title || (getEffectiveMetricType(member) === "sales" ? "Vendas" : "Reuniões")}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <AlertCircle className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Nenhum membro elegível</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-[300px]">
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
                <div key={idx} className="flex items-start gap-2 p-3 rounded-lg border border-border/50">
                  <span className="text-lg mt-1">{MEDAL_EMOJIS[idx]}</span>
                  <div className="flex-1 space-y-2">
                    <div className="flex gap-2">
                      <div className="flex gap-1">
                        {EMOJIS.map((e) => (
                          <button key={e} onClick={() => updatePrize(idx, "prize_icon", e)} className={`w-7 h-7 rounded text-sm ${prize.prize_icon === e ? "bg-primary/20 ring-1 ring-primary" : "hover:bg-muted"}`}>{e}</button>
                        ))}
                      </div>
                    </div>
                    <Input value={prize.prize_name} onChange={(e) => updatePrize(idx, "prize_name", e.target.value)} placeholder={`Prêmio do ${idx + 1}º lugar`} />
                    <Input value={prize.prize_value} onChange={(e) => updatePrize(idx, "prize_value", e.target.value)} placeholder="Valor em R$ (opcional)" type="number" />
                  </div>
                  {prizes.length > 0 && (
                    <button onClick={() => removePrize(idx)} className="p-1 hover:bg-destructive/10 rounded"><X className="w-4 h-4 text-muted-foreground" /></button>
                  )}
                </div>
              ))}
              {prizes.length < 5 && (
                <Button variant="outline" size="sm" onClick={addPrize} className="w-full">
                  <Plus className="w-4 h-4 mr-1" /> Adicionar posição
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Prêmios são opcionais. Você pode criar uma competição apenas pelo ranking.</p>
            </motion.div>
          )}

          {/* Step 3: Confirmação */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold">{name}</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Período:</span> {new Date(year, month - 1).toLocaleString("pt-BR", { month: "long", year: "numeric" })}</div>
                  <div><span className="text-muted-foreground">Critério:</span> {criteria === "absolute_value" ? "Valor absoluto" : "% da meta"}</div>
                  <div><span className="text-muted-foreground">Tipo:</span> {metricType === "sales" ? "Vendas" : "Reuniões"}</div>
                  <div><span className="text-muted-foreground">Participantes:</span> {selectedMembers.size}</div>
                </div>
                {prizes.filter((p) => p.prize_name.trim()).length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-1">Prêmios:</p>
                    {prizes.filter((p) => p.prize_name.trim()).map((p) => (
                      <div key={p.position} className="flex items-center gap-2 text-sm">
                        <span>{p.prize_icon}</span>
                        <span>{p.position}º — {p.prize_name}</span>
                        {p.prize_value && <span className="text-muted-foreground">R$ {Number(p.prize_value).toLocaleString("pt-BR")}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft className="w-4 h-4 mr-1" /> Voltar</Button>
          ) : <div />}

          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>Próximo <ArrowRight className="w-4 h-4 ml-1" /></Button>
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
