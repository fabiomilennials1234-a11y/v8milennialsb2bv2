import { useState } from "react";
import { UserPlus, CheckCircle2, ArrowRight, Loader2, ChevronRight } from "lucide-react";
import { useCreateLead } from "@/hooks/useLeads";
import { toast } from "sonner";

interface Props {
  onNext: () => void;
}

export function StepPrimeiroLead({ onNext }: Props) {
  const createLead = useCreateLead();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [done, setDone] = useState(false);

  const canSubmit = name.trim().length > 0;

  const handleCreate = async () => {
    if (!canSubmit) return;
    try {
      await createLead.mutateAsync({
        name: name.trim(),
        phone: phone.trim() || null,
        company: company.trim() || null,
        origin: "outro",
      });
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar lead");
    }
  };

  if (done) {
    return (
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        <div>
          <h3 className="text-xl font-bold tracking-tight">Primeiro lead criado!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            <strong>{name}</strong> está no pipeline de qualificação.
          </p>
        </div>
        <button
          onClick={onNext}
          className="w-full py-3.5 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
        >
          Ver resultado
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
          <UserPlus className="w-5 h-5 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">Adicione o primeiro lead</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Cadastre um contato real para ver o pipeline funcionando. Use um lead de teste se preferir.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Nome *
          </label>
          <input
            type="text"
            placeholder="Ex: Maria Souza"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-border/60 bg-muted/30 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-background transition-all"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Telefone / WhatsApp (opcional)
          </label>
          <input
            type="tel"
            placeholder="+55 11 99999-9999"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-border/60 bg-muted/30 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-background transition-all"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Empresa (opcional)
          </label>
          <input
            type="text"
            placeholder="Ex: Distribuidora ABC"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-border/60 bg-muted/30 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-background transition-all"
          />
        </div>
      </div>

      <div className="space-y-2">
        <button
          onClick={handleCreate}
          disabled={!canSubmit || createLead.isPending}
          className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all"
        >
          {createLead.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Criando lead...</>
          ) : (
            <><UserPlus className="w-4 h-4" /> Criar lead</>
          )}
        </button>

        <button
          onClick={onNext}
          className="w-full py-2.5 px-4 rounded-xl text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
        >
          Pular por agora
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
