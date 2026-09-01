import { useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { usePreferenciasDeAviso } from "../../hooks/usePreferenciasDeAviso";
import { usePushSubscription } from "../../hooks/use-push-subscription";
import type { PreferenciasDeAviso as Preferencias } from "../../lib/preferencias-de-aviso";

/**
 * A tela de preferências de Aviso.
 *
 * Substitui quatro interruptores que estavam aqui ligados a nada: mudar
 * qualquer um deles não mudava comportamento nenhum do produto.
 *
 * O que se decide aqui é ENTREGA. O Aviso continua sendo registrado de todo
 * jeito — o sino guarda o histórico mesmo do que não tocou.
 */

/** Cada linha desliga o som de um conjunto de tipos de uma vez. */
const GRUPOS_DE_SOM: { rotulo: string; descricao: string; tipos: string[] }[] = [
  {
    rotulo: "Mensagens de leads",
    descricao: "Quando um lead seu responde no WhatsApp",
    tipos: ["lead_message", "transfer_to_human"],
  },
  {
    rotulo: "Leads novos",
    descricao: "Quando um lead é atribuído a você",
    tipos: ["lead_new"],
  },
  {
    rotulo: "Agenda",
    descricao: "Reunião marcada, reunião em uma hora, follow-up do dia",
    tipos: ["meeting_booked", "meeting_soon", "follow_up_due", "follow_up_overdue"],
  },
  {
    rotulo: "Automações",
    descricao: "Quando uma automação para de rodar",
    tipos: ["workflow_alert", "cron_drift"],
  },
];

const HORAS = Array.from({ length: 24 }, (_, h) => h);

export function PreferenciasDeAviso() {
  const { preferencias, carregando, salvar } = usePreferenciasDeAviso();
  const { isSupported, permission, requestPermission, unsubscribe } = usePushSubscription();
  const [volumeLocal, setVolumeLocal] = useState<number | null>(null);

  const aplicar = async (mudanca: Partial<Preferencias>) => {
    try {
      await salvar(mudanca);
    } catch {
      toast.error("Não deu para salvar. Tente de novo.");
    }
  };

  const somDoGrupo = (tipos: string[]) =>
    tipos.every((tipo) => preferencias.overrides[tipo]?.som !== false);

  const alternarGrupo = (tipos: string[], ligado: boolean) => {
    const overrides = { ...preferencias.overrides };
    for (const tipo of tipos) {
      overrides[tipo] = { ...overrides[tipo], som: ligado };
    }
    void aplicar({ overrides });
  };

  const silencioLigado =
    preferencias.quiet_hours_start !== null && preferencias.quiet_hours_end !== null;

  return (
    <div className="space-y-6" aria-busy={carregando}>
      <div>
        <h3 className="text-lg font-medium">Notificações</h3>
        <p className="text-sm text-muted-foreground">
          Vale só para você, e só nesta organização. Tudo continua registrado no sino — o
          que muda aqui é o que interrompe.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label>Som</Label>
            <p className="text-sm text-muted-foreground">
              Desligado, nada toca — nem automação parada.
            </p>
          </div>
          <Switch
            checked={preferencias.sound_enabled}
            onCheckedChange={(v) => aplicar({ sound_enabled: v })}
          />
        </div>

        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <Label>Volume</Label>
            <span className="text-sm tabular-nums text-muted-foreground">
              {volumeLocal ?? preferencias.volume}
            </span>
          </div>
          <Slider
            value={[volumeLocal ?? preferencias.volume]}
            min={0}
            max={100}
            step={5}
            disabled={!preferencias.sound_enabled}
            onValueChange={([v]) => setVolumeLocal(v)}
            onValueCommit={([v]) => {
              setVolumeLocal(null);
              void aplicar({ volume: v });
            }}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label>Silenciar a conversa aberta</Label>
            <p className="text-sm text-muted-foreground">
              Não toca por mensagem do lead que já está na sua tela.
            </p>
          </div>
          <Switch
            checked={preferencias.mute_active_conversation}
            onCheckedChange={(v) => aplicar({ mute_active_conversation: v })}
          />
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Horário silencioso</Label>
              <p className="text-sm text-muted-foreground">
                Fora do expediente, o sino conta sem tocar. Automação parada atravessa.
              </p>
            </div>
            <Switch
              checked={silencioLigado}
              onCheckedChange={(v) =>
                aplicar(
                  v
                    ? { quiet_hours_start: 19, quiet_hours_end: 8 }
                    : { quiet_hours_start: null, quiet_hours_end: null },
                )
              }
            />
          </div>

          {silencioLigado && (
            <div className="mt-4 flex items-center gap-2">
              <Select
                value={String(preferencias.quiet_hours_start ?? 19)}
                onValueChange={(v) => aplicar({ quiet_hours_start: Number(v) })}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HORAS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">até</span>
              <Select
                value={String(preferencias.quiet_hours_end ?? 8)}
                onValueChange={(v) => aplicar({ quiet_hours_end: Number(v) })}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HORAS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label>Avisar no celular</Label>
            <p className="text-sm text-muted-foreground">
              {isSupported
                ? "Só quando você estiver longe do CRM, e só para o que é urgente."
                : "Este navegador não suporta notificação no aparelho."}
            </p>
            {permission === "denied" && (
              <p className="text-sm text-destructive">
                A permissão está bloqueada no navegador — libere nas configurações do site.
              </p>
            )}
          </div>
          <Switch
            checked={preferencias.push_enabled}
            disabled={!isSupported}
            onCheckedChange={async (v) => {
              // Guardar a preferência sem a permissão do navegador produziria um
              // interruptor ligado que não entrega nada — o defeito que esta
              // tela inteira veio corrigir.
              if (v) {
                await requestPermission();
                if (globalThis.Notification?.permission !== "granted") {
                  toast.error("O navegador negou a permissão de notificação.");
                  return;
                }
              } else {
                await unsubscribe();
              }
              await aplicar({ push_enabled: v });
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">O que faz som</h4>
        {GRUPOS_DE_SOM.map(({ rotulo, descricao, tipos }) => (
          <div key={rotulo} className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label>{rotulo}</Label>
              <p className="text-sm text-muted-foreground">{descricao}</p>
            </div>
            <Switch
              checked={somDoGrupo(tipos)}
              disabled={!preferencias.sound_enabled}
              onCheckedChange={(v) => alternarGrupo(tipos, v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
