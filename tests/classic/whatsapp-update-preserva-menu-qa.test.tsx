// QA (repro do bug original): a interface CLÁSSICA substituía a linha no UPDATE
// do Realtime; UPDATE de status sem raw_payload (TOAST inalterado) apagava o menu.
import { it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
let cb: ((p: unknown) => void) | null = null;
vi.mock("@/shared/realtime/useRealtimeChannel", () => ({ useRealtimeChannel: (o: { onEvent: (p: unknown) => void }) => { cb = o.onEvent; } }));
vi.mock("@/modules/identity", () => ({ useCurrentTeamMember: () => ({ data: { organization_id: "org-1" } }) }));
import { useWhatsAppMessagesRealtime } from "@/modules/communication/hooks/chat/useWhatsAppRealtime";
import { chatQueryKeys } from "@/modules/communication/hooks/chat/shared/queryKeys";
import { readUazapiMenu } from "@/modules/communication/lib/uazapiMenuDisplay";
const T = "5548999990003", I = "inst-1";
it("clássica: UPDATE de status sem raw_payload mantém o menu da bolha", () => {
  const row = { id: "r1", message_id: "w1", phone_number: T, instance_id: I, direction: "outgoing", status: "sent", content: "x", timestamp: "2026-10-05T15:00:00Z",
    uazapi_menu_title: "Planos", uazapi_menu_sections: [{ title: "S", rows: [{ title: "Pro" }] }], uazapi_menu_button: "Ver" };
  const qc = new QueryClient();
  qc.setQueryData(chatQueryKeys.messages("org-1", T, I), [row]);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  renderHook(() => useWhatsAppMessagesRealtime(T, I), { wrapper });
  expect(readUazapiMenu(row)).not.toBeNull();
  const { uazapi_menu_title, uazapi_menu_sections, uazapi_menu_button, ...semToast } = row;
  cb?.({ eventType: "UPDATE", new: { ...semToast, status: "delivered" }, old: { id: "r1" } });
  const m = (qc.getQueryData(chatQueryKeys.messages("org-1", T, I)) as Record<string, unknown>[])[0];
  expect(m.status).toBe("delivered");
  expect(readUazapiMenu(m)).not.toBeNull();
});
