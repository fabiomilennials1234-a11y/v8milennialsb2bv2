/**
 * SendToGroupConfig — painel do nó "Enviar p/ grupo" (`send_to_group`).
 *
 * O grupo pertence ao NÚMERO: só a instância que participa dele pode mandar.
 * Por isso a ordem da tela é número → grupo, trocar o número limpa o grupo, e
 * não há política de roteamento (o executor resolve a instância presa, sem
 * atalho nem recuo — `resolvePinnedInstance`).
 *
 * A lista de grupos vem do proxy (`listGroups`). Quando ela não vem — sem
 * permissão, provedor sem grupo, falha do provedor — o painel cai num campo
 * manual que só grava JID no formato que o executor aceita
 * (`isValidGroupJid`, gêmeo do backend).
 */

import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ActionNodeData } from "@/types/workflow";
import { useWhatsAppInstances } from "@/modules/communication";
import {
  isGroupCapableInstance,
  isValidGroupJid,
} from "@/modules/workflows/lib/instance-routing";
import { useInstanceGroups } from "@/modules/workflows/hooks/useInstanceGroups";
import { VariableInserter } from "@/modules/workflows/components/VariableInserter";
import {
  TemplateTextarea,
  type TemplateTextareaHandle,
} from "@/modules/workflows/components/TemplateTextarea";

type Props = {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
};

type GroupInstance = {
  id: string;
  instance_name: string;
  phone_number?: string | null;
  provider?: string | null;
  status?: string | null;
  session_dead_since?: string | null;
};

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
      <p className="text-xs text-warning">{children}</p>
    </div>
  );
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Campo manual. O nó guarda exatamente o que a tela mostra: JID válido é
 * gravado; vazio ou inválido LIMPA o nó (`groupJid: ""`). Se o valor antigo
 * sobrevivesse, a tela mostraria vazio/erro e o nó seguiria mandando para o
 * grupo anterior — e a ativação, vendo o campo preenchido, deixaria passar.
 */
function ManualGroupField({ data, onUpdate }: Props) {
  const [draft, setDraft] = useState(data.groupJid ?? "");
  const trimmed = draft.trim();
  const invalid = trimmed.length > 0 && !isValidGroupJid(trimmed);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="send-to-group-jid" className="text-xs text-muted-foreground">
        ID do grupo
      </Label>
      <Input
        id="send-to-group-jid"
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const value = next.trim();
          onUpdate({ groupJid: isValidGroupJid(value) ? value : "", groupName: "" });
        }}
        placeholder="120363000000000000@g.us"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        className={cn("font-mono text-xs", invalid && "border-destructive")}
      />
      {invalid && (
        <p className="text-xs text-destructive">
          Formato inválido — o ID do grupo são só dígitos terminando em @g.us.
        </p>
      )}
    </div>
  );
}

function GroupCombobox({
  data,
  onUpdate,
  groups,
}: Props & { groups: { jid: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const term = normalize(search.trim());
  const filtered = term
    ? groups.filter((g) => normalize(g.name).includes(term) || g.jid.includes(term))
    : groups;
  const selectedName =
    data.groupName || groups.find((g) => g.jid === data.groupJid)?.name || data.groupJid;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Grupo de destino"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !data.groupJid && "text-muted-foreground")}
        >
          <span className="truncate">{selectedName || "Selecione um grupo"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar grupo…" value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                Nenhum grupo com esse nome.
              </div>
            ) : (
              <CommandGroup>
                {filtered.map((g) => (
                  <CommandItem
                    key={g.jid}
                    value={g.jid}
                    onSelect={() => {
                      onUpdate({ groupJid: g.jid, groupName: g.name });
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        data.groupJid === g.jid ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{g.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function GroupField({ data, onUpdate, instanceId }: Props & { instanceId: string | undefined }) {
  const { data: list, isLoading, isError } = useInstanceGroups(instanceId);

  if (!instanceId) {
    return <p className="text-xs text-muted-foreground">Escolha o número primeiro.</p>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando grupos…
      </div>
    );
  }

  if (isError || !list) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Não foi possível listar os grupos deste número. Informe o ID do grupo
          manualmente.
        </p>
        <ManualGroupField data={data} onUpdate={onUpdate} />
      </div>
    );
  }

  // Vazio não é beco sem saída: a lista do provedor pode estar atrasada (grupo
  // recém-criado) e um nó já salvo precisa continuar mostrando o JID dele.
  if (list.groups.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Esta instância não participa de nenhum grupo. Adicione o número a um
          grupo no WhatsApp e volte aqui — ou informe o ID do grupo manualmente.
        </p>
        <ManualGroupField data={data} onUpdate={onUpdate} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <GroupCombobox data={data} onUpdate={onUpdate} groups={list.groups} />
      {list.truncated && (
        <p className="text-xs text-muted-foreground">
          Mostrando os primeiros 1.000 grupos em ordem alfabética — use a busca.
        </p>
      )}
    </div>
  );
}

export function SendToGroupConfig({ data, onUpdate }: Props) {
  const taRef = useRef<TemplateTextareaHandle>(null);
  const { data: instances, isLoading } = useWhatsAppInstances();

  const capable = useMemo(
    () => ((instances || []) as GroupInstance[]).filter(isGroupCapableInstance),
    [instances],
  );
  const selectedId = data.whatsappInstanceId || undefined;
  const selectedIsCapable = !!selectedId && capable.some((i) => i.id === selectedId);

  return (
    <>
      <div className="space-y-2">
        <Label>Número que envia</Label>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando instâncias...</p>
        ) : capable.length === 0 ? (
          <Aviso>
            Nenhum número Uazapi conectado. Envio para grupo só funciona por um
            número Uazapi — conecte um em Configurações &gt; WhatsApp.
          </Aviso>
        ) : (
          <>
            <Select
              value={selectedIsCapable ? selectedId : undefined}
              onValueChange={(id) => {
                const inst = capable.find((i) => i.id === id);
                onUpdate({
                  whatsappInstanceId: id,
                  whatsappInstanceName: inst?.instance_name ?? "",
                  instanceRoutingPolicy: "fixed",
                  // O grupo é do número: outro número, outro universo de grupos.
                  groupJid: "",
                  groupName: "",
                });
              }}
            >
              <SelectTrigger aria-label="Número que envia">
                <SelectValue placeholder="Selecione o número" />
              </SelectTrigger>
              <SelectContent>
                {capable.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.instance_name}
                    {inst.phone_number ? ` (${inst.phone_number})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedId && !selectedIsCapable && (
              <Aviso>
                O número salvo neste nó
                {data.whatsappInstanceName ? ` (${data.whatsappInstanceName})` : ""} não
                está conectado ou não envia para grupos. Este nó falha no envio até
                você escolher outro número.
              </Aviso>
            )}
          </>
        )}
      </div>

      {capable.length > 0 && (
        <div className="space-y-2">
          <Label>Grupo de destino</Label>
          <GroupField
            data={data}
            onUpdate={onUpdate}
            instanceId={selectedIsCapable ? selectedId : undefined}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>Mensagem</Label>
        <VariableInserter onInsert={(v) => taRef.current?.insertAtCursor(v)} />
        <TemplateTextarea
          ref={taRef}
          value={data.messageTemplate || ""}
          onChange={(v) => onUpdate({ messageTemplate: v })}
          placeholder="Lead {{nome}} ({{empresa}}) respondeu. Quem assume?"
          rows={4}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="space-y-0.5 pr-2">
          <Label className="text-sm">Resumir conversa do lead ao enviar</Label>
          <p className="text-xs text-muted-foreground">
            Anexa um resumo da conversa (IA) + o telefone do lead à mensagem. O
            resumo e o telefone do lead serão vistos por todos os membros do grupo
            e ficam registrados no histórico do chat do CRM.
          </p>
        </div>
        <Switch
          checked={!!data.includeConversationSummary}
          onCheckedChange={(v) => onUpdate({ includeConversationSummary: v })}
        />
      </div>
    </>
  );
}
