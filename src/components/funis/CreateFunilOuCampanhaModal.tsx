import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GitBranch, Target, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreatePipelineModal } from "@/components/custom-pipelines/CreatePipelineModal";
import { CreateCampanhaModal } from "@/components/campanhas/CreateCampanhaModal";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function CreateFunilOuCampanhaModal({ open, onOpenChange }: Props) {
  const [showCreatePipeline, setShowCreatePipeline] = useState(false);
  const [showCreateCampanha, setShowCreateCampanha] = useState(false);

  const handleChooseFunil = () => {
    onOpenChange(false);
    setShowCreatePipeline(true);
  };

  const handleChooseCampanha = () => {
    onOpenChange(false);
    setShowCreateCampanha(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="text-lg font-bold tracking-tight">O que você quer criar?</DialogTitle>
          </DialogHeader>

          <div className="px-6 pb-6 space-y-3">
            {/* Funil option */}
            <button
              onClick={handleChooseFunil}
              className="group w-full flex items-start gap-4 p-4 rounded-xl border-2 border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <GitBranch className="w-6 h-6 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold">Funil</p>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500">
                    Permanente
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Parte do processo comercial da empresa. Sempre ativo, estrutural, contínuo.
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex-shrink-0" />
            </button>

            {/* Campanha option */}
            <button
              onClick={handleChooseCampanha}
              className="group w-full flex items-start gap-4 p-4 rounded-xl border-2 border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-all text-left"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Target className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold">Campanha</p>
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                    Temporária
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Ação comercial com início, meio e fim. Metas, bônus e analytics para participantes.
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex-shrink-0" />
            </button>

            {/* Templates hint */}
            <div className="pt-2">
              <p className="text-[11px] text-muted-foreground/60 text-center">
                Templates disponíveis: Indicação • Prospecção • Reativação
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CreatePipelineModal open={showCreatePipeline} onOpenChange={setShowCreatePipeline} />
      <CreateCampanhaModal open={showCreateCampanha} onOpenChange={setShowCreateCampanha} />
    </>
  );
}
