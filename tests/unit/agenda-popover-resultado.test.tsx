import { it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { EventDetailPopover } from "@/modules/engagement/components/agenda/EventDetailPopover";
import type { UnifiedEvent } from "@/modules/engagement/components/agenda/agenda-helpers";
const REUNIAO: UnifiedEvent = {
  id: "meeting-11111111-1111-1111-1111-111111111111",
  title: "Reunião com o lead",
  start: new Date(2026, 7, 25, 15, 0),
  end: new Date(2026, 7, 25, 16, 0),
  allDay: false,
  source: "meeting",
  color: "hsl(47, 100%, 50%)",
  description: null,
  location: null,
  meetLink: null,
  leadId: null,
  leadName: null,
  leadCompany: null,
  creatorName: "Ana Souza",
  createdBy: "user-ana",
  status: "scheduled",
  eventType: "meeting",
  googleEventId: null,
  googleHtmlLink: null,
  googleCalendarOwnerId: null,
  googleCalendarColor: null,
  googleCalendarOwnerName: null,
};


it("trocar Alex por James deve mostrar resultado salvo de James", () => {
 const props = {onClose:vi.fn(),onDeleteMeeting:vi.fn(),onDeleteGoogleEvent:vi.fn(),onSetOutcome:vi.fn()};
 const alex = {...REUNIAO,id:"meeting_event-alex",title:"Alex",source:"meeting_event" as const};
 const james = {...REUNIAO,id:"meeting-james",title:"James",status:"no_show"};
 const {rerender} = render(<EventDetailPopover {...props} state={{event:alex,x:300,y:300}}/>);
 expect(screen.queryByRole("button",{name:"Não compareceu"})).toBeNull();
 rerender(<EventDetailPopover {...props} state={{event:james,x:300,y:300}}/>);
 expect(screen.getByRole("button",{name:"Não compareceu"})).toHaveAttribute("aria-pressed","true");
});

it("refetch do mesmo evento atualiza o resultado exibido", () => {
  const props = {onClose:vi.fn(),onDeleteMeeting:vi.fn(),onDeleteGoogleEvent:vi.fn(),onSetOutcome:vi.fn()};
  const {rerender} = render(<EventDetailPopover {...props} state={{event:REUNIAO,x:300,y:300}}/>);
  rerender(<EventDetailPopover {...props} state={{event:{...REUNIAO,status:"completed"},x:300,y:300}}/>);
  expect(screen.getByRole("button",{name:"Compareceu"})).toHaveAttribute("aria-pressed","true");
});

it("falha de gravação do evento anterior não altera outro card", async () => {
  let rejectSave!: (reason: Error) => void;
  const save = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
  const props = {onClose:vi.fn(),onDeleteMeeting:vi.fn(),onDeleteGoogleEvent:vi.fn(),onSetOutcome:save};
  const {rerender} = render(<EventDetailPopover {...props} state={{event:REUNIAO,x:300,y:300}}/>);
  await act(async () => { screen.getByRole("button",{name:"Compareceu"}).click(); });
  rerender(<EventDetailPopover {...props} state={{event:{...REUNIAO,id:"meeting-other",status:"no_show"},x:300,y:300}}/>);
  await act(async () => { rejectSave(new Error("network")); });
  expect(screen.getByRole("button",{name:"Não compareceu"})).toHaveAttribute("aria-pressed","true");
});
