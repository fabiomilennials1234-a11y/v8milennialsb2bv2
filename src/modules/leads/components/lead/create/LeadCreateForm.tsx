/**
 * LeadCreateForm — formulário de criação de lead a partir do chat.
 *
 * Extraído de LeadDetailContent (Onda 3.1, C7).
 * Gerencia estado local de campos de criação + chama callbacks do pai.
 */

import { useState, useEffect } from "react";
import { Plus, Loader2, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { originOptions } from "@/lib/lead/lead-origins";
import {
  isStandardDestination,
  DEST_TO_PIPE_TYPE,
} from "@/lib/lead/lead-destinations";
import type { LeadDestination } from "@/modules/communication/hooks/useWhatsAppLeadIntegration";
import { usePipeOps } from "../../../pipe-ops";
import { useCampanhas } from "@/modules/campaigns/hooks/useCampanhas";
import { useTeamMembers, useCurrentTeamMember } from "@/modules/identity";
export interface CreateLeadPayload {
  phone: string;
  name: string;
  company: string;
  email: string;
  rating: number;
  notes: string;
  origin: string;
  sdrId?: string;
  destination: LeadDestination;
  campanhaId?: string;
  customPipelineId?: string;
  customStageId?: string;
  stageId?: string;
}

interface LeadCreateFormProps {
  phoneNumber: string;
  pushName?: string | null;
  onSubmit: (payload: CreateLeadPayload) => Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function LeadCreateForm({
  phoneNumber,
  pushName,
  onSubmit,
  onCancel,
  isSubmitting = false,
}: LeadCreateFormProps) {
  const [name, setName] = useState(pushName || "");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState(0);
  const [origin, setOrigin] = useState("whatsapp");
  const [sdrId, setSdrId] = useState("");
  const [destination, setDestination] = useState<LeadDestination>("qualificacao");
  const [campanhaId, setCampanhaId] = useState("");
  const [customPipelineId, setCustomPipelineId] = useState("");
  const [customStageId, setCustomStageId] = useState("");
  const [stageId, setStageId] = useState("");

  const { data: teamMember } = useCurrentTeamMember();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: campanhas = [] } = useCampanhas();
  const pipeOps = usePipeOps();
  const { data: customPipelines = [] } = pipeOps.useCustomPipelines();
  const { data: customPipeStages = [] } = pipeOps.useCustomPipelineStages(
    destination === "custom" ? customPipelineId : undefined
  );
  const { stagesByPipe: dynamicStagesByPipe } = pipeOps.useAllPipelineStageOptions();

  // Auto-select current member as SDR on mount
  useEffect(() => {
    if (teamMember?.id && !sdrId) {
      setSdrId(teamMember.id);
    }
  }, [teamMember?.id, sdrId]);

  // Reset stage/pipeline on destination change
  useEffect(() => {
    setStageId("");
    setCustomStageId("");
    setCustomPipelineId("");
  }, [destination]);

  useEffect(() => {
    setCustomStageId("");
  }, [customPipelineId]);

  const isStandardDest = isStandardDestination(destination);
  const activeCampanhas = campanhas.filter((c) => c.is_active);

  const getStandardStages = (dest: string) => {
    const pipeType = DEST_TO_PIPE_TYPE[dest];
    if (!pipeType || !dynamicStagesByPipe[pipeType]) return [];
    return dynamicStagesByPipe[pipeType].map((s) => ({ id: s.value, label: s.label }));
  };

  const standardStagesForCreate = getStandardStages(destination);

  const isDisabled = () => {
    if (isSubmitting || !name) return true;
    if (destination === "campanha" && !campanhaId) return true;
    if (destination === "custom" && (!customPipelineId || !customStageId)) return true;
    if (isStandardDest && !stageId) return true;
    return false;
  };

  const handleSubmit = () => {
    onSubmit({
      phone: phoneNumber,
      name,
      company,
      email,
      rating,
      notes,
      origin,
      sdrId: sdrId || undefined,
      destination,
      campanhaId: destination === "campanha" ? campanhaId : undefined,
      customPipelineId: destination === "custom" ? customPipelineId : undefined,
      customStageId: destination === "custom" ? customStageId : undefined,
      stageId: isStandardDest ? stageId : undefined,
    });
  };

  return (
    <div className="space-y-4 py-4 overflow-y-auto px-6">
      {/* Header */}
      <div className="text-center pb-4">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
          <Plus className="w-8 h-8 text-primary" />
        </div>
        <h3 className="font-semibold text-lg">Criar Novo Lead</h3>
        <p className="text-sm text-muted-foreground">
          Este contato ainda não está no CRM. Preencha os dados para criar um lead.
        </p>
      </div>

      <div className="grid gap-4">
        {/* Name */}
        <div className="grid gap-2">
          <Label htmlFor="create-name">Nome *</Label>
          <Input
            id="create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do lead"
          />
        </div>

        {/* Company */}
        <div className="grid gap-2">
          <Label htmlFor="create-company">Empresa</Label>
          <Input
            id="create-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Nome da empresa"
          />
        </div>

        {/* Email */}
        <div className="grid gap-2">
          <Label htmlFor="create-email">Email</Label>
          <Input
            id="create-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@exemplo.com"
          />
        </div>

        {/* Notes */}
        <div className="grid gap-2">
          <Label htmlFor="create-notes">Notas</Label>
          <Textarea
            id="create-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações sobre o lead..."
            rows={3}
          />
        </div>

        <Separator />

        {/* Origin */}
        <div className="grid gap-2">
          <Label htmlFor="create-origin">Origem *</Label>
          <Select value={origin} onValueChange={setOrigin}>
            <SelectTrigger id="create-origin">
              <SelectValue placeholder="Selecione a origem" />
            </SelectTrigger>
            <SelectContent>
              {originOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Responsible */}
        <div className="grid gap-2">
          <Label htmlFor="create-responsible">Responsável</Label>
          <Select value={sdrId} onValueChange={setSdrId}>
            <SelectTrigger id="create-responsible">
              <SelectValue placeholder="Selecione o responsável" />
            </SelectTrigger>
            <SelectContent>
              {teamMembers.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Destination */}
        <div className="grid gap-2">
          <Label htmlFor="create-destination">Destino</Label>
          <Select
            value={
              destination === "custom"
                ? `custom:${customPipelineId}`
                : destination
            }
            onValueChange={(v) => {
              if (v.startsWith("custom:")) {
                setDestination("custom");
                setCustomPipelineId(v.replace("custom:", ""));
              } else {
                setDestination(v as LeadDestination);
              }
            }}
          >
            <SelectTrigger id="create-destination">
              <SelectValue placeholder="Selecione o destino" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Funis Padrão</SelectLabel>
                <SelectItem value="qualificacao">Qualificação</SelectItem>
                <SelectItem value="confirmacao">Confirmação</SelectItem>
                <SelectItem value="propostas">Propostas</SelectItem>
              </SelectGroup>
              {customPipelines.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Funis Customizados</SelectLabel>
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
                <SelectItem value="campanha">Campanha</SelectItem>
                <SelectItem value="none">Nenhum</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Stage: standard pipelines */}
        {isStandardDest && (
          <div className="grid gap-2">
            <Label>Etapa</Label>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa..." />
              </SelectTrigger>
              <SelectContent>
                {standardStagesForCreate.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Stage: custom pipeline */}
        {destination === "custom" && customPipelineId && (
          <div className="grid gap-2">
            <Label>Etapa</Label>
            <Select value={customStageId} onValueChange={setCustomStageId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a etapa..." />
              </SelectTrigger>
              <SelectContent>
                {customPipeStages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Campaign selector */}
        {destination === "campanha" && (
          <div className="grid gap-2">
            <Label htmlFor="create-campanha">Campanha</Label>
            <Select value={campanhaId} onValueChange={setCampanhaId}>
              <SelectTrigger id="create-campanha">
                <SelectValue placeholder="Selecione a campanha..." />
              </SelectTrigger>
              <SelectContent>
                {activeCampanhas.map((campanha) => (
                  <SelectItem key={campanha.id} value={campanha.id}>
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      {campanha.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4">
        {onCancel && (
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button
          className={onCancel ? "flex-1" : "w-full"}
          onClick={handleSubmit}
          disabled={isDisabled()}
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}
          Criar Lead
        </Button>
      </div>
    </div>
  );
}
