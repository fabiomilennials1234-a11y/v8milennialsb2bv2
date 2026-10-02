import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GitBranch, Target, Plus, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { CreatePipelineModal, useAvailableSystemPipes, useCreateCustomPipeline, useEnableSystemPipe } from "@/modules/pipelines";
import type { SystemPipeType } from "@/modules/pipelines";
import { FUNIL_DE_VENDAS_NOME, FUNIL_DE_VENDAS_STAGES } from "@/contracts/pipe";
import { toast } from "sonner";

interface CreateNewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// SCRUM-637 (flip): funil de sistema também navega pela rota única.
const pipeRoute = (pipeType: string) => `/funil/${pipeType}`;

export function CreateNewModal({ open, onOpenChange }: CreateNewModalProps) {
  const [step, setStep] = useState<"choice" | "funnel-templates" | "create-pipeline">("choice");
  const navigate = useNavigate();
  const hiddenPipes = useAvailableSystemPipes();
  const enablePipe = useEnableSystemPipe();
  const createPipeline = useCreateCustomPipeline();

  // SCRUM-641: o ÚNICO modelo do produto. Mesma trilha que a org nova ganha
  // de fábrica no servidor — aqui como template de criação manual, pelo
  // caminho comum de funil (papéis chegam pela fila classify-stage-roles).
  const handleCreateSalesFunnel = async () => {
    try {
      const pipeline = await createPipeline.mutateAsync({
        name: FUNIL_DE_VENDAS_NOME,
        icon: "trending-up",
        color: "#f59e0b",
        custom_stages: [...FUNIL_DE_VENDAS_STAGES],
      });
      toast.success("Funil criado com sucesso!");
      if (pipeline?.slug) navigate(`/funil/${pipeline.slug}`);
      handleClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar funil");
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setTimeout(() => setStep("choice"), 200);
  };

  const handleActivateHiddenPipe = async (pipeType: string) => {
    try {
      // Caminho canônico dos funis semeados (SCRUM-618/635): a RPC
      // `enable_system_pipeline` cria o registro, repara o espelho em
      // `pipelines` E semeia as etapas server-side — o funil nasce pronto.
      // (Era `toggleVisibility({visible:true})`, um UPDATE que com a linha
      // ausente "ativava" sem criar nada.)
      await enablePipe.mutateAsync(pipeType as SystemPipeType);
      toast.success("Funil criado com sucesso!");
      const route = pipeRoute(pipeType);
      if (route) navigate(route);
      handleClose();
    } catch {
      toast.error("Erro ao ativar funil");
    }
  };

  const handleCreateCampaign = () => {
    // Campanhas legadas foram retiradas — campanhas viraram funis com prazo
    navigate("/funis");
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
                    className="flex-1 rounded-card bg-primary-soft p-5 text-center text-primary-soft-foreground transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-relevo"
                  >
                    <GitBranch className="mx-auto mb-2 h-7 w-7" />
                    <p className="text-sm font-bold text-foreground">Funil</p>
                    <p className="text-xs text-muted-foreground mt-1">Permanente</p>
                  </button>
                  <button
                    onClick={handleCreateCampaign}
                    className="flex-1 rounded-card bg-warning/15 p-5 text-center text-warning-strong transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-relevo"
                  >
                    <Target className="mx-auto mb-2 h-7 w-7" />
                    <p className="text-sm font-bold text-foreground">Campanha</p>
                    <p className="text-xs text-muted-foreground mt-1">Temporária</p>
                  </button>
                </div>
                <div className="mt-3 rounded-xl bg-muted/50 p-3">
                  <p className="text-center text-xs text-muted-foreground">
                    <strong className="text-primary-soft-foreground">Funil</strong> = processo contínuo da operação &nbsp;|&nbsp;
                    <strong className="text-warning-strong">Campanha</strong> = ação com prazo, meta e incentivos
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
                    <DialogTitle>Criar funil</DialogTitle>
                  </div>
                </DialogHeader>
                <p className="text-xs text-muted-foreground mt-2">
                  Comece em branco ou a partir de um modelo — modelos já nascem com as etapas prontas.
                </p>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <button
                    onClick={handleOpenCreatePipeline}
                    className="rounded-xl bg-primary-soft p-4 text-left transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-relevo"
                  >
                    <Plus className="mb-2 h-5 w-5 text-primary-soft-foreground" />
                    <p className="font-semibold text-sm">Em branco</p>
                    <p className="text-xs text-muted-foreground mt-1">Etapas personalizadas</p>
                  </button>

                  {/* SCRUM-641: o único modelo do produto — mesma trilha do funil de fábrica. */}
                  <button
                    onClick={handleCreateSalesFunnel}
                    disabled={createPipeline.isPending}
                    className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 disabled:opacity-50"
                  >
                    <p className="font-semibold text-sm">{FUNIL_DE_VENDAS_NOME}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Novo → Em conversa → Reunião → Proposta → Ganhou/Perdeu
                    </p>
                    <p className="mt-1 text-xs font-semibold text-primary-soft-foreground">Criar com etapas prontas</p>
                  </button>

                  {/* Reativação de funil legado OCULTO (org antiga com registro). */}
                  {hiddenPipes.map((pipe) => (
                    <button
                      key={pipe.pipe_type}
                      onClick={() => handleActivateHiddenPipe(pipe.pipe_type)}
                      disabled={enablePipe.isPending}
                      className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 disabled:opacity-50"
                    >
                      <p className="font-semibold text-sm">{pipe.display_name}</p>
                      <p className="text-xs text-muted-foreground mt-1">Você já teve este funil — está oculto</p>
                      <p className="mt-1 text-xs font-semibold text-primary-soft-foreground">Clique para reativar</p>
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
