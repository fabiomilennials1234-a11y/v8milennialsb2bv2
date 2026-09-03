/**
 * SocialCreateLeadDialog — cria o lead JÁ vinculado à conversa de Instagram.
 *
 * Um formulário, uma chamada, uma transação. Criar aqui e vincular depois seria
 * duas operações separadas: dois cliques (ou dois vendedores na mesma conversa)
 * produziriam dois leads e um vínculo órfão, e nenhum índice de `leads` pegaria
 * isso — o único guarda de unicidade desta fatia é o da identidade social, do
 * lado do servidor.
 *
 * O QUE É FIXO E POR QUÊ:
 *  · ORIGEM = Instagram, não editável. É o que permite segmentar (ou excluir)
 *    esses leads nos disparos por origem depois; deixar o vendedor escolher
 *    "whatsapp" apagaria de onde a pessoa veio.
 *  · RESPONSÁVEL = quem está criando. O servidor resolve pelo `auth.uid()` —
 *    oferecer um seletor aqui seria um controle que a RPC ignora.
 *  · TELEFONE = opcional, com a microcopy dizendo o que ele destrava. É o campo
 *    que separa um lead completo de um lead mutilado, e este é o único momento
 *    em que a pessoa está lendo a conversa e sabe o número.
 *
 * CAMPANHA fica de fora da lista de destinos de propósito: campanha dispara
 * sequência por WhatsApp, e um lead recém-criado sem telefone entraria numa
 * fila que nunca envia.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import { useCustomPipelines, useCustomPipelineStages, usePipelineDisplayConfig } from "@/modules/pipelines";
import { destinosDeSistema } from "@/contracts/pipe";
import { isStandardDestination } from "@/lib/lead/lead-destinations";
import { useCurrentTeamMember } from "@/modules/identity";
import type { LeadDestination } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import type { CreateLeadFromSocialInput } from "@/modules/communication/hooks/chat/useSocialLeadLink";

export interface SocialCreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nome sugerido — display_name do Instagram, ou @handle, ou sufixo do IGSID. */
  suggestedName: string;
  isSubmitting?: boolean;
  onSubmit: (
    values: Omit<CreateLeadFromSocialInput, "messagingChannelId" | "externalUserId">,
  ) => void;
}

export function SocialCreateLeadDialog({
  open,
  onOpenChange,
  suggestedName,
  isSubmitting = false,
  onSubmit,
}: SocialCreateLeadDialogProps) {
  const [name, setName] = useState(suggestedName);
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [destination, setDestination] = useState<LeadDestination>("qualificacao");
  const [customPipelineId, setCustomPipelineId] = useState("");
  const [customStageId, setCustomStageId] = useState("");

  const { data: teamMember } = useCurrentTeamMember();
  const { data: customPipelines = [] } = useCustomPipelines();
  // Funis de sistema REAIS da org, com o nome que ELA usa (SCRUM-641) — o trio
  // cravado oferecia funil que a org podia nem ter, com nome de seed que
  // nenhuma navegação mostra.
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const destinosSistema = destinosDeSistema(displayConfigs);
  const { data: customStages = [] } = useCustomPipelineStages(
    destination === "custom" ? customPipelineId || undefined : undefined,
  );

  // Reabrir o diálogo com um contato diferente tem de trazer o nome dele, não o
  // do contato anterior — o estado local não sabe que a conversa mudou.
  useEffect(() => {
    if (open) {
      setName(suggestedName);
      setCompany("");
      setEmail("");
      setPhone("");
      setDestination("qualificacao");
      setCustomPipelineId("");
      setCustomStageId("");
    }
  }, [open, suggestedName]);

  useEffect(() => {
    setCustomStageId("");
  }, [customPipelineId]);

  // Mesma correção do LeadCreateForm (#1848): o chute "qualificacao" só é
  // verdadeiro em org que TEM esse funil. Sem isto, org sem ele abriria o
  // Select vazio, sem erro.
  useEffect(() => {
    if (!displayConfigs) return;
    if (!isStandardDestination(destination)) return;
    if (destinosSistema.some((d) => d.destination === destination)) return;
    setDestination((destinosSistema[0]?.destination ?? "none") as LeadDestination);
    // destinosSistema é derivado de displayConfigs; a dependência real é a query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayConfigs, destination]);

  const canSubmit = useMemo(() => {
    if (isSubmitting) return false;
    if (!name.trim()) return false;
    if (destination === "custom" && (!customPipelineId || !customStageId)) return false;
    return true;
  }, [isSubmitting, name, destination, customPipelineId, customStageId]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      company: company.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      destination,
      customPipelineId: destination === "custom" ? customPipelineId : null,
      customStageId: destination === "custom" ? customStageId : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar lead da conversa</DialogTitle>
          <DialogDescription>
            O lead nasce vinculado a esta conversa. As mensagens que já chegaram
            passam a fazer parte da ficha dele.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="social-lead-name">Nome *</Label>
            <Input
              id="social-lead-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do lead"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="social-lead-company">Empresa</Label>
            <Input
              id="social-lead-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Nome da empresa"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="social-lead-email">E-mail</Label>
            <Input
              id="social-lead-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="social-lead-phone">Telefone</Label>
            <Input
              id="social-lead-phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
            />
            <p className="text-[11.5px] leading-snug text-muted-foreground">
              Opcional. Com telefone o lead recebe disparo, abre no WhatsApp e é
              atendido pelo Copilot.
            </p>
          </div>

          <Separator />

          <div className="grid gap-2">
            <Label>Origem</Label>
            <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-border/60 bg-muted/30 text-sm text-muted-foreground">
              <ChannelBadge channel="instagram" size={16} />
              <span>Instagram</span>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="social-lead-destination">Destino</Label>
            <Select
              value={
                destination === "custom" && customPipelineId
                  ? `custom:${customPipelineId}`
                  : destination
              }
              onValueChange={(v) => {
                if (v.startsWith("custom:")) {
                  setDestination("custom");
                  setCustomPipelineId(v.replace("custom:", ""));
                } else {
                  setDestination(v as LeadDestination);
                  setCustomPipelineId("");
                }
              }}
            >
              <SelectTrigger id="social-lead-destination">
                <SelectValue placeholder="Selecione o destino" />
              </SelectTrigger>
              <SelectContent>
                {/* Sem rótulo de espécie: funil é funil. */}
                {destinosSistema.length > 0 && (
                  <SelectGroup>
                    {destinosSistema.map((d) => (
                      <SelectItem key={d.destination} value={d.destination}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {customPipelines.length > 0 && (
                  <SelectGroup>
                    {customPipelines.map((pipe) => (
                      <SelectItem key={pipe.id} value={`custom:${pipe.id}`}>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: pipe.color }}
                          />
                          {pipe.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                <SelectGroup>
                  <SelectLabel>Outros</SelectLabel>
                  <SelectItem value="none">Nenhum</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {destination === "none" && (
              <p className="text-[11.5px] leading-snug text-muted-foreground">
                Sem funil o lead não aparece em nenhum quadro — só na lista de
                leads.
              </p>
            )}
          </div>

          {destination === "custom" && customPipelineId && (
            <div className="grid gap-2">
              <Label>Etapa</Label>
              <Select value={customStageId} onValueChange={setCustomStageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a etapa..." />
                </SelectTrigger>
                <SelectContent>
                  {customStages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: stage.color ?? undefined }}
                        />
                        {stage.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <p className="text-[11.5px] leading-snug text-muted-foreground">
            Responsável: {teamMember?.name ?? "você"}.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Criar e vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
