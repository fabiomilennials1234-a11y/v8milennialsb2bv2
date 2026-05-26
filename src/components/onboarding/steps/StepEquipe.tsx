import { useState } from "react";
import { Users, Plus, CheckCircle2, ArrowRight, Loader2, ChevronRight } from "lucide-react";
import { useCreateTeamMember } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Props {
  onNext: () => void;
}

export function StepEquipe({ onNext }: Props) {
  const { organizationId } = useOrganization();
  const createMember = useCreateTeamMember();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("member");
  const [done, setDone] = useState(false);

  const canSubmit = name.trim().length > 0;

  const handleAdd = async () => {
    if (!organizationId || !canSubmit) return;
    try {
      await createMember.mutateAsync({
        organization_id: organizationId,
        name: name.trim(),
        email: email.trim() || null,
        role,
        is_active: true,
      });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao adicionar membro";
      toast.error(msg);
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
          <h3 className="text-xl font-bold tracking-tight">Membro adicionado!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            <strong>{name}</strong> foi adicionado(a) como {role === "admin" ? "Admin" : "Vendedor"}.
          </p>
        </div>
        <button
          onClick={onNext}
          className="w-full py-3.5 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
        >
          Continuar
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
          <Users className="w-5 h-5 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">Convide sua equipe</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Adicione o primeiro membro do time de vendas. Você pode convidar mais pessoas depois.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Nome *
          </label>
          <input
            type="text"
            placeholder="Ex: João Silva"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-border/60 bg-muted/30 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-background transition-all"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            E-mail (opcional)
          </label>
          <input
            type="email"
            placeholder="joao@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-border/60 bg-muted/30 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-background transition-all"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Papel
          </label>
          <div className="mt-1.5 flex gap-2">
            {([["member", "Vendedor"], ["admin", "Admin"]] as [AppRole, string][]).map(([r, label]) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={cn(
                  "flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all",
                  role === r
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/60 bg-muted/30 text-muted-foreground hover:border-border"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <button
          onClick={handleAdd}
          disabled={!canSubmit || createMember.isPending}
          className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all"
        >
          {createMember.isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Adicionando...</>
          ) : (
            <><Plus className="w-4 h-4" /> Adicionar membro</>
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
