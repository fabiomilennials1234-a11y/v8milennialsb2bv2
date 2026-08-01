/**
 * InstanceRoutingSelector — declara de qual Instance o WhatsApp Message Node
 * envia (PRD #1331).
 *
 * Substitui "Automático (primeira disponível)", que prometia escolha sensata e
 * entregava uma linha arbitrária do banco. Aqui a regra tem nome, fica visível
 * na mesma tela em que a mensagem é escrita, e traz o recuo declarado ao lado —
 * quem monta o funil lê o contrato inteiro sem executar nada.
 */

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWhatsAppInstances } from "@/modules/communication";
import {
  INSTANCE_ROUTING_POLICIES,
  buildFallbackChange,
  buildFixedInstanceChange,
  buildPolicyChange,
  describeRoutingPolicy,
  instanceRoutingLabel,
  policyUsesFallback,
  readRoutingPolicy,
  type InstanceRoutingFields,
  type InstanceRoutingPolicy,
} from "@/modules/workflows/lib/instance-routing";

/** Radix Select não aceita `""` como valor de item; sentinela para "sem recuo". */
const SEM_RECUO = "__sem_recuo__";

type ConnectedInstance = { id: string; instance_name: string; phone_number: string | null };

/** Uma Instance conectada como opção — nome e, quando houver, o número. */
function InstanceOptions({ instances }: { instances: ConnectedInstance[] }) {
  return (
    <>
      {instances.map((inst) => (
        <SelectItem key={inst.id} value={inst.id}>
          {inst.instance_name}
          {inst.phone_number ? ` (${inst.phone_number})` : ""}
        </SelectItem>
      ))}
    </>
  );
}

export function InstanceRoutingSelector({
  data,
  onUpdate,
}: {
  data: InstanceRoutingFields;
  onUpdate: (patch: Partial<InstanceRoutingFields>) => void;
}) {
  const { data: instances, isLoading } = useWhatsAppInstances();

  const connected = (instances || []).filter(
    (i) => i.status === "connected" || i.status === "open",
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Enviar por</Label>
        <p className="text-xs text-muted-foreground">Carregando instâncias...</p>
      </div>
    );
  }

  if (connected.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Enviar por</Label>
        <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
          <p className="text-xs text-warning">
            Nenhuma instância WhatsApp conectada. Configure em Configurações &gt;
            WhatsApp.
          </p>
        </div>
      </div>
    );
  }

  const policy = readRoutingPolicy(data);

  // Com um número conectado só não existe escolha errada a proteger: o recuo
  // seria sempre esse mesmo número. Esconder o campo evita pedir uma decisão
  // que não existe.
  const single = connected.length === 1;
  const showFallback = policyUsesFallback(policy) && !single;

  const nameOf = (id: string) =>
    connected.find((i) => i.id === id)?.instance_name || "";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Enviar por</Label>
        <Select
          value={policy}
          onValueChange={(v) => onUpdate(buildPolicyChange(v as InstanceRoutingPolicy))}
        >
          <SelectTrigger aria-label="Enviar por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INSTANCE_ROUTING_POLICIES.map((p) => (
              <SelectItem key={p} value={p}>
                {instanceRoutingLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {describeRoutingPolicy(policy, { hasSingleInstance: single })}
        </p>
      </div>

      {policy === "fixed" && (
        <div className="space-y-2">
          <Label>Número de saída</Label>
          <Select
            value={data.whatsappInstanceId || ""}
            onValueChange={(v) => onUpdate(buildFixedInstanceChange(v, nameOf(v)))}
          >
            <SelectTrigger aria-label="Número de saída">
              <SelectValue placeholder="Selecione a instância" />
            </SelectTrigger>
            <SelectContent>
              <InstanceOptions instances={connected} />
            </SelectContent>
          </Select>
        </div>
      )}

      {showFallback && (
        <div className="space-y-2">
          <Label>Se não houver conversa</Label>
          <Select
            value={data.fallbackInstanceId || SEM_RECUO}
            onValueChange={(v) =>
              onUpdate(
                v === SEM_RECUO
                  ? buildFallbackChange("", "")
                  : buildFallbackChange(v, nameOf(v)),
              )
            }
          >
            <SelectTrigger aria-label="Se não houver conversa">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_RECUO}>Nenhum — falhar o envio</SelectItem>
              <InstanceOptions instances={connected} />
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Usado quando o lead ainda não trocou nenhuma mensagem. Sem recuo
            declarado, o envio falha em vez de escolher um número sozinho.
          </p>
        </div>
      )}
    </div>
  );
}
