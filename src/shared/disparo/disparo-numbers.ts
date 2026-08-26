/**
 * disparo-numbers — o mapeador ÚNICO de Instances para números do Disparo (#1722).
 *
 * Sucede `components/disparo-wizard/instances-to-numbers.ts` (#908), que servia
 * só ao wizard. Agora o Disparo Rápido consulta o MESMO módulo: as duas telas
 * discordavam — o wizard filtrava por provedor e o Disparo Rápido não —, e era
 * dessa discordância que nascia o erro cru `notificame does not support
 * senderAdvanced` na tela do vendedor (ADR-0028 §6).
 *
 * Existe UM Disparo, e a Instance escolhida decide o REGIME (ADR-0028 §1):
 *
 *   chip     → texto livre, motor do fornecedor (`/sender/*` da Uazapi)
 *   oficial  → Template aprovado, motor próprio por destinatário
 *
 * Puro e sem relógio (o `now` entra por parâmetro), para ser testado sem React.
 *
 * Mora em `src/shared/` e não em `campaigns/` (#1846). Duas telas de bounded
 * contexts diferentes precisam da MESMA decisão: o wizard vive em `campaigns` e
 * o Disparo Rápido em `leads`. Publicar isto pelo barrel de `campaigns` obrigava
 * `leads` a importar `campaigns`, e essa aresta fechava o ciclo
 * campaigns ↔ communication que o `Dep-cruise ratchet` reprovava no PR #1811.
 * Aqui o módulo é FOLHA do grafo — não importa módulo nenhum, logo não pode
 * participar de ciclo. Mantenha assim: um único import de módulo aqui recria o
 * problema.
 */
import { effectiveCap, CAP_RECOMMENDED } from "./speed-safety";

/** Statuses de conexão do provedor (Uazapi `open`, genérico `connected`). */
const CONNECTED_STATUSES = new Set(["open", "connected"]);

/**
 * Regime de conteúdo do Disparo, decidido pela Instance.
 *
 * Não é preferência de tela: é o que a Meta permite. Quem recebe um Disparo
 * está, por definição, fora da janela de 24 horas — e fora dela o canal oficial
 * só aceita Template aprovado.
 */
export type RegimeDeDisparo = "chip" | "oficial";

/**
 * Provedores de CHIP — texto livre em massa pelo motor do fornecedor.
 *
 * ALLOWLIST, nunca denylist: provedor novo nasce excluído até alguém decidir
 * que pertence aqui. Esta lista é a de #908, INTOCADA — o critério 8 do #1722
 * exige que a Organization só com Chip se comporte exatamente como hoje.
 *
 * ⚠️ Não derivar de `capabilities.massSend` do perfil de provedor: medido em
 * `whatsapp-provider.ts:81`, o Evolution tem `massSend: false` lá e está aqui.
 * Derivar removeria o Evolution do wizard — mudança de comportamento no Chip.
 * A divergência entre as duas listas é vigiada por teste gêmeo.
 */
const CHIP_PROVIDERS = new Set(["uazapi", "evolution"]);

/**
 * Provedores de CANAL OFICIAL — Template aprovado pelo motor próprio.
 *
 * Só `notificame`. O `meta_cloud` também é oficial e também é template-gated,
 * mas o transporte de Disparo desta fatia é o do NotificaMe
 * (`sendTemplateViaInstance` → `NotificameProvider.sendTemplate`); listá-lo
 * ofereceria um número que ninguém sabe disparar. Fica excluído, fail-closed,
 * como estava.
 */
const OFICIAL_PROVIDERS = new Set(["notificame"]);

/** Uma linha criada dentro desta janela é tratada como nova (bane mais fácil). */
export const NEW_NUMBER_WINDOW_DAYS = 14;
const NEW_NUMBER_WINDOW_MS = NEW_NUMBER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Forma mínima da Instance — subconjunto estrutural da linha da tabela. */
export interface InstanceLike {
  id: string;
  instance_name?: string | null;
  phone_number?: string | null;
  status?: string | null;
  created_at?: string | null;
  provider?: string | null;
  /**
   * O tipo de canal, quando a linha vem de `messaging_channels` (#1722).
   *
   * `whatsapp_instances` NÃO tem esta coluna — ela é o discriminador contra o
   * canal social, que nasce com `provider: "notificame"` e `status: "connected"`,
   * a mesma dupla que qualifica o Canal Oficial.
   */
  channel_type?: string | null;
}

/** Um número oferecido pelo Disparo, com o regime que ele impõe ao conteúdo. */
export interface DisparoNumber {
  id: string;
  label: string;
  /** Number Daily Cap efetivo — máximo de envios/dia (após o clamp de novo). */
  cap: number;
  selected: boolean;
  /** Linha recém-conectada: auto-clampada abaixo do slider (#908). */
  isNew?: boolean;
  /** O que esta Instance permite como conteúdo (#1722). */
  regime: RegimeDeDisparo;
}

/**
 * O regime da Instance, ou `null` se ela não dispara.
 *
 * `null` é a resposta fail-closed e cobre três casos distintos, de propósito no
 * mesmo balde: provedor ausente, provedor desconhecido, e provedor oficial sem
 * transporte de Disparo (`meta_cloud`).
 */
export function regimeDaInstancia(i: InstanceLike): RegimeDeDisparo | null {
  // Canal social do MESMO provedor: Direct de Instagram e página de Facebook
  // não têm Template de WhatsApp, e a linha deles carrega exatamente o
  // `provider`/`status` que qualificaria o Canal Oficial. Só o `channel_type`
  // os separa — e ele só existe do lado social, então ausente é WhatsApp.
  const canal = String(i.channel_type ?? "whatsapp").toLowerCase();
  if (canal !== "whatsapp") return null;

  // Case-insensitive, como o módulo que este sucede sempre foi. Um
  // `provider: "Uazapi"` que caísse no fail-closed deixaria a Organization sem
  // número nenhum, sem explicação — critério 8 é comportamento idêntico.
  const provider = (i.provider ?? "").toLowerCase();
  if (CHIP_PROVIDERS.has(provider)) return "chip";
  if (OFICIAL_PROVIDERS.has(provider)) return "oficial";
  return null;
}

/** A Instance dispara em algum regime? */
export function isBlastableInstance(i: InstanceLike): boolean {
  return regimeDaInstancia(i) !== null;
}

/** A Instance está conectada, no vocabulário do provedor? */
export function isConnectedInstance(i: InstanceLike): boolean {
  return CONNECTED_STATUSES.has(String(i.status ?? "").toLowerCase());
}

/**
 * O rótulo humano de uma Instance: nome, senão telefone, senão posição.
 *
 * Exportado porque o Disparo Rápido precisa dele no ramo em que NENHUMA linha
 * está conectada — ali ele lista as desconectadas, que `instancesToNumbers` não
 * devolve. Sem isto a fórmula existia em dois lugares, que é a mesma forma de
 * defeito que este módulo veio acabar.
 */
export function rotuloDaInstancia(i: InstanceLike, idx: number): string {
  return (
    (i.instance_name ?? "").trim() ||
    (i.phone_number ?? "").trim() ||
    `Número ${idx + 1}`
  );
}

/**
 * Transforma as Instances da Organization nos números que o Disparo oferece.
 *
 * O primeiro conectado nasce selecionado — o wizard precisa de um número válido
 * desde o primeiro passo.
 */
export function instancesToNumbers(
  instances: InstanceLike[],
  nowMs: number,
  defaultCap: number = CAP_RECOMMENDED,
): DisparoNumber[] {
  return instances
    .filter((i) => isConnectedInstance(i) && isBlastableInstance(i))
    .map((i, idx) => {
      const createdMs = i.created_at ? Date.parse(i.created_at) : NaN;
      const isNew =
        Number.isFinite(createdMs) && nowMs - createdMs < NEW_NUMBER_WINDOW_MS;
      return {
        id: i.id,
        label: rotuloDaInstancia(i, idx),
        cap: effectiveCap(defaultCap, isNew),
        selected: idx === 0,
        isNew,
        // Já filtrado por `isBlastableInstance` — o `!` é o que o filtro provou.
        regime: regimeDaInstancia(i)!,
      };
    });
}
