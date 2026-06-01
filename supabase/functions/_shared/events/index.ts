/**
 * Event-bus interno — barrel.
 *
 * Para emissores: importar `publishEvent` + tipos do evento.
 * Para dispatcher: importar `dispatchPending`.
 * Para registrar handler novo: ver `registry.ts`.
 */

export { publishEvent } from "./publish.ts";
export { dispatchPending } from "./dispatch.ts";
export { getHandler, handlers, type EventHandler } from "./registry.ts";
export type {
  DispatchResult,
  DomainEvent,
  DomainEventRow,
  EventType,
  LeadStageChangedEvent,
  LeadStageChangedPayload,
} from "./types.ts";
