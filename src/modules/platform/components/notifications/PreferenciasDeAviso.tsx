import { useState } from "react";
import { toast } from "sonner";
import {
  BellRing,
  CalendarCheck,
  CalendarClock,
  MessageSquare,
  Moon,
  Sun,
  UserPlus,
  Volume1,
  Volume2,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import torqueMark from "@/assets/torque-mark.png";
import { FocusCard, FocusTile, IconChip, InkPanel } from "@/components/ui/bento";
import { cn } from "@/lib/utils";

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
import { motorDeSom } from "../../lib/motor-de-som";
import { timbreDoTipo } from "../../lib/decisao-de-entrega";
import type { PreferenciasDeAviso as Preferencias } from "../../lib/preferencias-de-aviso";
import { botaoNoOuroPrimario, chaveNaTinta, vidroNaTinta } from "../settings/settings-classes";
import { notifyError } from "@/shared/errors";

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
const GRUPOS_DE_SOM: { rotulo: string; descricao: string; tipos: string[]; icone: LucideIcon }[] = [
  {
    icone: MessageSquare,
    rotulo: "Mensagens de leads",
    descricao: "Quando um lead seu responde no WhatsApp",
    tipos: ["lead_message", "transfer_to_human"],
  },
  {
    icone: UserPlus,
    rotulo: "Leads novos",
    descricao: "Quando um lead é atribuído a você",
    tipos: ["lead_new"],
  },
  {
    icone: CalendarClock,
    rotulo: "Agenda",
    descricao: "Reunião marcada, reunião em uma hora, follow-up do dia",
    tipos: ["meeting_booked", "meeting_soon", "follow_up_due", "follow_up_overdue"],
  },
  {
    icone: CalendarCheck,
    rotulo: "Mensagens agendadas",
    descricao: "Quando uma mensagem que você agendou é enviada ou falha",
    tipos: ["scheduled_message_sent", "scheduled_message_failed"],
  },
  {
    icone: Workflow,
    rotulo: "Automações",
    descricao: "Quando uma automação para de rodar",
    tipos: ["workflow_alert", "cron_drift"],
  },
];

const HORAS = Array.from({ length: 24 }, (_, h) => h);

/** O seletor de hora sobre a tinta: vidro em vez do branco do cartão. */
const seletorNaTinta = "h-9 w-[88px] rounded-full border-white/10 bg-white/[.06] text-tinta-foreground focus:ring-offset-tinta";

export function PreferenciasDeAviso() {
  const { preferencias, carregando, salvar } = usePreferenciasDeAviso();
  const { isSupported, permission, requestPermission, unsubscribe } = usePushSubscription();
  const [volumeLocal, setVolumeLocal] = useState<number | null>(null);

  const aplicar = async (mudanca: Partial<Preferencias>) => {
    try {
      await salvar(mudanca);
    } catch (caught) {
      notifyError(caught, { fallback: "Não deu para salvar. Tente de novo." });
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
  const volume = volumeLocal ?? preferencias.volume;
  const gruposComSom = GRUPOS_DE_SOM.filter((g) => somDoGrupo(g.tipos)).length;
  const ouvir = (tipo: string) => {
    motorDeSom.destravar();
    motorDeSom.tocar(timbreDoTipo(tipo), preferencias.volume);
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]" aria-busy={carregando}>
      {/* Quando avisar — uma linha por grupo de aviso, com o som de cada um. */}
      <section
        aria-labelledby="quando-avisar-titulo"
        className="overflow-hidden rounded-card border border-card-border bg-card text-card-foreground shadow-relevo"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
          <div className="min-w-0">
            <h3 id="quando-avisar-titulo" className="text-base font-bold tracking-tight">
              Quando avisar
            </h3>
            <p className="mt-0.5 max-w-[60ch] text-[12.5px] text-muted-foreground">
              Vale só para você, e só nesta organização. Tudo continua registrado no sino — o que muda aqui é o que
              interrompe.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold tabular-nums text-foreground/75">
            {gruposComSom} de {GRUPOS_DE_SOM.length} com som
          </span>
        </div>

        <div
          aria-hidden
          className="flex items-center justify-between border-y border-border bg-muted/40 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground sm:px-6"
        >
          <span>Aviso</span>
          <span>Som</span>
        </div>

        <ul className="divide-y divide-border">
          {GRUPOS_DE_SOM.map(({ rotulo, descricao, tipos, icone: Icone }) => {
            const ligado = somDoGrupo(tipos);
            return (
              <li key={rotulo} className="flex items-center gap-3 px-5 py-4 sm:px-6">
                <IconChip icon={Icone} tone={ligado && preferencias.sound_enabled ? "gold" : "neutral"} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold tracking-tight">{rotulo}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{descricao}</p>
                </div>
                {/* Ouvir o timbre é a única forma de escolher com informação — e
                    serve de diagnóstico: se o teste toca e o Aviso não, o problema
                    está na entrega, não no áudio. */}
                <button
                  type="button"
                  onClick={() => ouvir(tipos[0])}
                  disabled={!preferencias.sound_enabled || !ligado}
                  aria-label={`Ouvir o som de ${rotulo}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                >
                  <Volume2 className="h-3.5 w-3.5" aria-hidden />
                  Ouvir
                </button>
                <Switch
                  checked={ligado}
                  disabled={!preferencias.sound_enabled}
                  onCheckedChange={(v) => alternarGrupo(tipos, v)}
                  aria-label={`Som de ${rotulo}`}
                />
              </li>
            );
          })}
        </ul>
      </section>

      {/* Som e silêncio — os ajustes que valem para todos os avisos. */}
      <InkPanel title="Som e silêncio" className="lg:sticky lg:top-4">
        <div className="space-y-2.5">
          {/* Prévia: o aviso como ele chega, com o volume escolhido. */}
          <FocusCard className="gap-3 p-4">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-tinta">
                <img src={torqueMark} alt="" className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-[12px] font-bold">
                  Torque CRM
                  <span className="text-[11px] font-semibold text-primary-foreground/60">agora</span>
                </p>
                <p className="mt-0.5 text-[14px] font-extrabold leading-snug tracking-[-0.01em]">
                  Um lead seu respondeu no WhatsApp
                </p>
                <p className="mt-0.5 text-[12px] text-primary-foreground/70">É assim que o aviso chega com o som ligado.</p>
              </div>
            </div>
            <FocusTile className="flex items-center justify-between gap-3 py-2">
              <span className="text-[11.5px] font-bold text-primary-foreground/70">
                Prévia do aviso ·{" "}
                {preferencias.sound_enabled ? `volume ${volume}%` : "som desligado"}
              </span>
              <button
                type="button"
                onClick={() => ouvir("lead_message")}
                disabled={!preferencias.sound_enabled}
                className={botaoNoOuroPrimario}
              >
                <BellRing />
                Ouvir
              </button>
            </FocusTile>
          </FocusCard>

          <div className={cn(vidroNaTinta, "flex items-center justify-between gap-4")}>
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="aviso-som" className="text-tinta-foreground">Som</Label>
              <p className="text-[12px] text-tinta-muted">Desligado, nada toca — nem automação parada.</p>
            </div>
            <Switch
              id="aviso-som"
              className={chaveNaTinta}
              checked={preferencias.sound_enabled}
              onCheckedChange={(v) => aplicar({ sound_enabled: v })}
            />
          </div>

          <div className={vidroNaTinta}>
            <div className="mb-3 flex items-center justify-between">
              <Label className="text-tinta-foreground">Volume</Label>
              <span className="text-sm font-bold tabular-nums text-tinta-foreground">{volume}%</span>
            </div>
            <div className="flex items-center gap-3">
              <Volume1 className="h-4 w-4 shrink-0 text-tinta-muted" aria-hidden />
              <Slider
                value={[volume]}
                min={0}
                max={100}
                step={5}
                disabled={!preferencias.sound_enabled}
                aria-label="Volume dos avisos"
                onValueChange={([v]) => setVolumeLocal(v)}
                onValueCommit={([v]) => {
                  setVolumeLocal(null);
                  void aplicar({ volume: v });
                }}
              />
              <Volume2 className="h-4 w-4 shrink-0 text-tinta-muted" aria-hidden />
            </div>
          </div>

          <div className={cn(vidroNaTinta, "flex items-center justify-between gap-4")}>
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="aviso-conversa-aberta" className="text-tinta-foreground">Silenciar a conversa aberta</Label>
              <p className="text-[12px] text-tinta-muted">Não toca por mensagem do lead que já está na sua tela.</p>
            </div>
            <Switch
              id="aviso-conversa-aberta"
              className={chaveNaTinta}
              checked={preferencias.mute_active_conversation}
              onCheckedChange={(v) => aplicar({ mute_active_conversation: v })}
            />
          </div>

          <div className={vidroNaTinta}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="aviso-silencio" className="text-tinta-foreground">Horário silencioso</Label>
                <p className="text-[12px] text-tinta-muted">
                  Fora do expediente, o sino conta sem tocar. Automação parada atravessa.
                </p>
              </div>
              <Switch
                id="aviso-silencio"
                className={chaveNaTinta}
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
              <div className="mt-3.5 flex items-center gap-2">
                <Moon className="h-4 w-4 shrink-0 text-tinta-muted" aria-hidden />
                <Select
                  value={String(preferencias.quiet_hours_start ?? 19)}
                  onValueChange={(v) => aplicar({ quiet_hours_start: Number(v) })}
                >
                  <SelectTrigger aria-label="Começa às" className={seletorNaTinta}>
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
                <span className="text-sm text-tinta-muted">até</span>
                <Sun className="h-4 w-4 shrink-0 text-tinta-muted" aria-hidden />
                <Select
                  value={String(preferencias.quiet_hours_end ?? 8)}
                  onValueChange={(v) => aplicar({ quiet_hours_end: Number(v) })}
                >
                  <SelectTrigger aria-label="Termina às" className={seletorNaTinta}>
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

          <div className={cn(vidroNaTinta, "flex items-center justify-between gap-4")}>
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="aviso-celular" className="text-tinta-foreground">Avisar no celular</Label>
              <p className="text-[12px] text-tinta-muted">
                {isSupported
                  ? "Só quando você estiver longe do CRM, e só para o que é urgente."
                  : "Este navegador não suporta notificação no aparelho."}
              </p>
              {permission === "denied" && (
                <p className="text-[12px] text-destructive">
                  A permissão está bloqueada no navegador — libere nas configurações do site.
                </p>
              )}
            </div>
            <Switch
              id="aviso-celular"
              className={chaveNaTinta}
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

          <p className="px-1 pt-1 text-[11px] text-tinta-muted">As mudanças valem na hora — não há o que salvar.</p>
        </div>
      </InkPanel>
    </div>
  );
}
