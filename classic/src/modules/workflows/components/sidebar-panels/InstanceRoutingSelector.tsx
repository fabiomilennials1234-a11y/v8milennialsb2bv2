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
  deadPinShortcut,
  describeRoutingPolicy,
  instanceRoutingLabel,
  isChipInstance,
  isOfficialChannel,
  isRoutableInstance,
  policyUsesFallback,
  readRoutingPolicy,
  type InstanceRoutingFields,
  type InstanceRoutingPolicy,
} from "@/modules/workflows/lib/instance-routing";

/** Radix Select não aceita `""` como valor de item; sentinela para "sem recuo". */
const SEM_RECUO = "__sem_recuo__";

type ConnectedInstance = {
  id: string;
  instance_name: string;
  phone_number: string | null;
  provider?: string | null;
};

/** Uma Instance conectada como opção — nome e, quando houver, o número. */
function InstanceOptions({ instances }: { instances: ConnectedInstance[] }) {
  return (
    <>
      {instances.map((inst) => (
        <SelectItem key={inst.id} value={inst.id}>
          {inst.instance_name}
          {inst.phone_number ? ` (${inst.phone_number})` : ""}
          {/* O canal oficial se comporta diferente — janela de 24h, sem PIX —
              e escolher sem saber disso é escolher no escuro. */}
          {isOfficialChannel(inst) ? " · canal oficial" : ""}
        </SelectItem>
      ))}
    </>
  );
}

/**
 * O nó aponta para um número que não está mais na lista.
 *
 * Medido em 2026-08-20: 63 nós ativos em 9 organizações estão assim, e nenhum
 * declara recuo. Até aqui o campo simplesmente ficava vazio e o operador não
 * tinha como saber — o envio seguia funcionando pelo atalho de "uma Instance
 * viva só", até a organização ganhar um segundo número e parar.
 *
 * O aviso não bloqueia: descreve o que o executor vai fazer HOJE, que é o que
 * o operador precisa para decidir se age. O nome vem de `deadPinShortcut`, a
 * mesma função que o executor consulta — ver `nomeDoAtalho` abaixo.
 */
function PinObsoleto({ fallbackName }: { fallbackName: string | null }) {
  return (
    <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
      <p className="text-xs text-warning">
        {fallbackName
          ? `O número escolhido neste nó não existe mais. Hoje o envio sai por ${fallbackName}, porque é o único número conectado da organização — se outro for conectado, este nó passa a falhar.`
          : "O número escolhido neste nó não existe mais, e a organização tem mais de um número conectado. Este nó falha no envio. Escolha um número."}
      </p>
    </div>
  );
}

export function InstanceRoutingSelector({
  data,
  onUpdate,
  fixedOnly = false,
}: {
  data: InstanceRoutingFields;
  onUpdate: (patch: Partial<InstanceRoutingFields>) => void;
  /**
   * Nó cujos destinatários são números fixos, não o lead (`send_to_number`).
   * Não há conversa a seguir nem responsável a consultar, então só o número de
   * saída faz sentido — oferecer as políticas seria oferecer regra que não se
   * aplica.
   */
  fixedOnly?: boolean;
}) {
  const { data: instances, isLoading } = useWhatsAppInstances();

  // Duas listas. Até o #1690 a diferença entre elas era o canal oficial: ele
  // podia ser NOMEADO e não podia ser ESCOLHIDO. O #1700 acabou com essa
  // diferença nos degraus automáticos — o oficial conta no atalho, resolve em
  // `conversation` e `responsible`, e pode ser recuo.
  //
  // `routable` espelha `listRoutable` do backend: o universo de tudo — a lista
  // de "Número de saída", a lista do recuo, e a contagem de "uma Instance viva
  // só".
  //
  // `chips` espelha `LEGACY_PROVIDERS`, e sobrou em dois lugares, os dois
  // porque o executor também os recorta assim: o nó `send_to_number` e o aviso
  // de fixa obsoleta.
  const routable = (instances || []).filter(isRoutableInstance);
  const chips = (instances || []).filter(isChipInstance);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Enviar por</Label>
        <p className="text-xs text-muted-foreground">Carregando instâncias...</p>
      </div>
    );
  }

  if (routable.length === 0) {
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

  // O universo DESTE nó — o mesmo que o executor recebe em `providers`:
  // `LEGACY_PROVIDERS` para `send_to_number`, `ROUTABLE_PROVIDERS` para o resto.
  const universo = fixedOnly ? chips : routable;

  const nameOf = (id: string) =>
    universo.find((i) => i.id === id)?.instance_name || "";

  // O id gravado no nó sumiu do universo do nó: instância removida, recriada —
  // ou de um provedor que este nó não aceita. Ver `PinObsoleto`.
  const pinObsoleto =
    !!data.whatsappInstanceId && !universo.some((i) => i.id === data.whatsappInstanceId);

  // Por onde o executor manda HOJE um nó de fixa morta: exatamente o recorte de
  // `deadPinShortcut`, e um nome só quando ele resolve um número só.
  const atalho = deadPinShortcut(universo);
  const nomeDoAtalho = atalho.length === 1 ? atalho[0].instance_name : null;

  if (fixedOnly) {
    // ⚠️ AQUI O CANAL OFICIAL NÃO ENTRA, e depois do #1700 é o único lugar do
    // painel onde ele é recusado. O executor recusa igual: o handler de
    // `send_to_number` passa `LEGACY_PROVIDERS` como `providers`.
    //
    // `send_to_number` manda para números avulsos — vendedores, gestores — que
    // não são leads e não têm conversa de entrada. Pela regra da Meta, a janela
    // de 24 horas desses números está fechada por definição: nunca houve
    // mensagem do outro lado para abri-la. Texto livre pelo canal oficial ali é
    // recusa garantida, e a recusa chega por callback, depois de a tela dizer
    // "enviado". Oferecer a opção seria oferecer uma armadilha.
    return (
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
            <InstanceOptions instances={chips} />
          </SelectContent>
        </Select>
        {pinObsoleto && <PinObsoleto fallbackName={nomeDoAtalho} />}
        <p className="text-xs text-muted-foreground">
          {chips.length === 0
            ? "Este nó envia para números avulsos, e o canal oficial não alcança quem nunca escreveu antes. Conecte um número de WhatsApp comum."
            : chips.length === 1
              ? "A organização tem um número conectado — a mensagem sai por ele."
              : "Sem número escolhido, o envio falha em vez de escolher um sozinho."}
        </p>
      </div>
    );
  }

  const policy = readRoutingPolicy(data);

  // Com um número conectado só não existe escolha errada a proteger: o recuo
  // seria sempre esse mesmo número. Esconder o campo evita pedir uma decisão
  // que não existe.
  //
  // ⚠️ Isto conta o canal oficial desde o #1700, e a mudança é visível: uma org
  // com chip e oficial passa de "um número" para "dois", e o campo de recuo
  // aparece onde não aparecia. É o correto — o executor também passou a contar
  // dois ali, e esconder o campo tiraria do operador a única declaração que
  // resolve o nó quando a política não resolve.
  const single = routable.length === 1;
  const showFallback = policyUsesFallback(policy) && !single;

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
              <InstanceOptions instances={routable} />
            </SelectContent>
          </Select>
          {pinObsoleto && <PinObsoleto fallbackName={nomeDoAtalho} />}
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
              {/* O canal oficial entra aqui desde o #1700: o degrau 4 do
                  executor o aceita como recuo declarado. */}
              <InstanceOptions instances={routable} />
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
