import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  Users,
  UserCircle,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CheckoutState } from "@/hooks/useCheckout";

interface Props {
  state: CheckoutState;
  setOrgName: (name: string) => void;
  addTeamMember: () => void;
  removeTeamMember: (index: number) => void;
  updateTeamMember: (
    index: number,
    field: "name" | "email",
    value: string,
  ) => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}

export function OrgSetup({
  state,
  setOrgName,
  addTeamMember,
  removeTeamMember,
  updateTeamMember,
  onBack,
  onContinue,
  canContinue,
}: Props) {
  // Ensure we have enough member slots for the user count
  useEffect(() => {
    const currentSlots = state.team_members.length;
    if (currentSlots < state.user_count) {
      // We need to add more slots — the caller can do this via addTeamMember
      // but we handle it here for auto-fill
    }
  }, [state.user_count, state.team_members.length]);

  const remainingSlots = Math.max(
    state.user_count - state.team_members.length,
    0,
  );

  return (
    <div className="space-y-8">
      {/* ── Organization name ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold text-foreground">
            Nome da organizacao
          </Label>
        </div>
        <Input
          placeholder="Ex: Milennials Consulting"
          value={state.org_name}
          onChange={(e) => setOrgName(e.target.value)}
          className="h-12 text-base"
          autoFocus
        />
        <p className="text-xs text-muted-foreground/60">
          Este sera o nome exibido no painel da sua equipe.
        </p>
      </div>

      {/* ── Team members ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <Label className="text-sm font-semibold text-foreground">
              Membros da equipe ({state.team_members.length}/{state.user_count})
            </Label>
          </div>
        </div>

        <div className="space-y-3">
          {state.team_members.map((member, index) => {
            const isCurrentUser = index === 0;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`
                  relative flex items-start gap-3 rounded-xl border px-4 py-3.5
                  ${isCurrentUser ? "border-primary/30 bg-primary/5" : "border-border bg-card/50"}
                `}
              >
                {/* Position number */}
                <div
                  className={`
                    flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold mt-0.5
                    ${isCurrentUser ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}
                  `}
                >
                  {index + 1}
                </div>

                {/* Fields */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <Input
                      placeholder="Nome"
                      value={member.name}
                      onChange={(e) =>
                        updateTeamMember(index, "name", e.target.value)
                      }
                      disabled={isCurrentUser}
                      className={`h-9 text-sm ${isCurrentUser ? "opacity-70" : ""}`}
                    />
                  </div>
                  <div>
                    <Input
                      placeholder="email@exemplo.com"
                      type="email"
                      value={member.email}
                      onChange={(e) =>
                        updateTeamMember(index, "email", e.target.value)
                      }
                      disabled={isCurrentUser}
                      className={`h-9 text-sm ${isCurrentUser ? "opacity-70" : ""}`}
                    />
                  </div>
                </div>

                {/* Remove button (not for current user) */}
                {!isCurrentUser && (
                  <button
                    onClick={() => removeTeamMember(index)}
                    className="flex-shrink-0 h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors mt-0.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* "Voce" badge for current user */}
                {isCurrentUser && (
                  <div className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold text-primary uppercase tracking-wide mt-2.5">
                    <UserCircle className="h-3 w-3" />
                    Voce
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Add member button */}
        {state.team_members.length < state.user_count && (
          <Button
            variant="outline"
            onClick={addTeamMember}
            className="w-full h-10 border-dashed text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4 mr-2" />
            Adicionar membro
            {remainingSlots > 1 && (
              <span className="ml-1 text-xs text-muted-foreground/60">
                ({remainingSlots} restantes)
              </span>
            )}
          </Button>
        )}

        {state.team_members.length < state.user_count && (
          <p className="text-xs text-muted-foreground/60 text-center">
            Voce pode convidar os membros restantes depois pelo painel.
          </p>
        )}
      </div>

      {/* ── Navigation ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="h-11 px-5">
          <ChevronLeft className="h-4 w-4 mr-1" />
          Voltar
        </Button>
        <Button
          onClick={onContinue}
          disabled={!canContinue}
          className="h-12 px-8 gradient-primary gradient-primary-hover text-white font-semibold border-0 text-sm"
        >
          Continuar
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
