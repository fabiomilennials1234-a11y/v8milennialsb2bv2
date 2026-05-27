import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, Target, Plus, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { CreatePipelineModal } from "@/modules/pipelines/components/custom/CreatePipelineModal";
import { useHiddenDefaultPipes, useTogglePipeVisibility } from "@/modules/pipelines/hooks/usePipelineDisplayConfig";
import { toast } from "sonner";

interface CreateNewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PIPE_ROUTES: Record<string, string> = {
  whatsapp: "/pipe-whatsapp",
  confirmacao: "/pipe-confirmacao",
  propostas: "/pipe-propostas",
};

export function CreateNewModal({ open, onOpenChange }: CreateNewModalProps) {
  const [step, setStep] = useState<"choice" | "funnel-templates" | "create-pipeline">("choice");
  const navigate = useNavigate();
  const hiddenPipes = useHiddenDefaultPipes();
  const toggleVisibility = useTogglePipeVisibility();

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => setStep("choice"), 200);
  };

  const handleActivateHiddenPipe = async (pipeType: string) => {
    try {
      await toggleVisibility.mutateAsync({ pipeType, visible: true });
      toast.success("Funil ativado com sucesso!");
      const route = PIPE_ROUTES[pipeType];
      if (route) navigate(route);
      handleClose();
    } catch {
      toast.error("Erro ao ativar funil");
    }
  };

  const handleCreateCampaign = () => {
    navigate("/campanhas?create=true");
    handleClose();
  };

  const handleOpenCreatePipeline = () => {
    handleClose();
    // Small delay to let the first modal close before opening the next
    setTimeout(() => setStep("create-pipeline"), 250);
  };

  return (
    <>
      <Dialog open={open && step !== "create-pipeline"} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <AnimatePresence mode="wait">
            {step === "choice" && (
              <motion.div key="choice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <DialogHeader>
                  <DialogTitle>Criar novo</DialogTitle>
                </DialogHeader>
                <div className="flex gap-4 mt-4">
                  <button
                    onClick={() => setStep("funnel-templates")}
                    className="flex-1 bg-primary/5 border border-primary/20 rounded-xl p-5 text-center hover:border-primary/40 transition-colors"
                  >
                    <GitBranch className="w-7 h-7 text-primary mx-auto mb-2" />
                    <p className="font-semibold text-sm">Funil</p>
                    <p className="text-xs text-muted-foreground mt-1">Permanente</p>
                  </button>
                  <button
                    onClick={handleCreateCampaign}
                    className="flex-1 bg-orange-500/5 border border-orange-500/20 rounded-xl p-5 text-center hover:border-orange-500/40 transition-colors"
                  >
                    <Target className="w-7 h-7 text-orange-500 mx-auto mb-2" />
                    <p className="font-semibold text-sm">Campanha</p>
                    <p className="text-xs text-muted-foreground mt-1">Temporária</p>
                  </button>
                </div>
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground text-center">
                    <strong className="text-primary">Funil</strong> = processo contínuo da operação &nbsp;|&nbsp;
                    <strong className="text-orange-500">Campanha</strong> = ação com prazo, meta e incentivos
                  </p>
                </div>
              </motion.div>
            )}

            {step === "funnel-templates" && (
              <motion.div key="templates" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                <DialogHeader>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setStep("choice")}>
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <DialogTitle>Criar Funil</DialogTitle>
                  </div>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <button
                    onClick={handleOpenCreatePipeline}
                    className="bg-primary/5 border border-primary/20 rounded-lg p-4 text-left hover:border-primary/40 transition-colors"
                  >
                    <Plus className="w-5 h-5 text-primary mb-2" />
                    <p className="font-semibold text-sm">Em branco</p>
                    <p className="text-xs text-muted-foreground mt-1">Stages personalizados</p>
                  </button>

                  {hiddenPipes.map((pipe) => (
                    <button
                      key={pipe.pipe_type}
                      onClick={() => handleActivateHiddenPipe(pipe.pipe_type)}
                      className="bg-muted/30 border border-border rounded-lg p-4 text-left hover:border-primary/30 transition-colors"
                    >
                      <p className="font-semibold text-sm">{pipe.display_name}</p>
                      <p className="text-xs text-muted-foreground mt-1">Oculto no seu perfil</p>
                      <p className="text-xs text-primary mt-1">Clique para ativar</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>

      <CreatePipelineModal
        open={step === "create-pipeline"}
        onOpenChange={(v) => { if (!v) setStep("choice"); }}
      />
    </>
  );
}
