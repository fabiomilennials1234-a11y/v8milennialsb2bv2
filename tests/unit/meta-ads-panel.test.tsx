import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MetaAdsReadPanel } from "@/modules/platform/components/settings/MetaAdsReadPanel";
const f=vi.hoisted(()=>({org:"org-a",role:"admin",invoke:vi.fn()}));
vi.mock("@/modules/identity",()=>({useOrganization:()=>({organizationId:f.org,role:f.role,timezone:"America/Sao_Paulo"}),useMasterAuth:()=>({isMaster:false})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{functions:{invoke:f.invoke}}}));
const panel=(client:QueryClient)=><QueryClientProvider client={client}><MetaAdsReadPanel /></QueryClientProvider>;
beforeEach(()=>{vi.clearAllMocks();f.org="org-a";f.role="admin";f.invoke.mockImplementation(async(_name:string,{body}:{body:{action:string;organization_id:string;after?:string}})=>({data:body.action==="accounts"?{accounts:[{account_id:body.organization_id==="org-a"?"act_1":"act_2",name:body.organization_id==="org-a"?"Conta A":"Conta B",currency:"BRL"}]}:{data:[{campaign_id:body.after?"2":"1",campaign_name:body.after?"Segunda campanha":body.organization_id==="org-a"?"Campanha A":"Campanha B",impressions:"100",clicks:"5",spend:"10.00"}],after:body.after?null:"next-cursor"},error:null}));});
describe("tenant Ads panel",()=>{
 it("shows authorized accounts and reads/paginates metrics for the selected organization",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(panel(client));await screen.findByText("Campanha A");
  expect(screen.getByLabelText("Conta de anúncios")).toHaveValue("act_1");expect(screen.getByRole("table")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Carregar mais campanhas"}));await screen.findByText("Segunda campanha");
  expect(f.invoke).toHaveBeenCalledWith("meta-ad-insights",{body:expect.objectContaining({organization_id:"org-a",accountId:"act_1",after:"next-cursor"})});
 });
 it("does not show another organization's cached metrics during a switch",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,placeholderData:(previous:unknown)=>previous}}});const view=render(panel(client));await screen.findByText("Campanha A");
  f.org="org-b";view.rerender(panel(client));expect(screen.queryByText("Campanha A")).not.toBeInTheDocument();await screen.findByText("Campanha B");
  expect(f.invoke).toHaveBeenCalledWith("meta-ad-insights",{body:expect.objectContaining({organization_id:"org-b",accountId:"act_2"})});
 });
 it("does not request financial metrics for a member",()=>{
  f.role="member";const client=new QueryClient();const view=render(panel(client));expect(view.container).toBeEmptyDOMElement();expect(f.invoke).not.toHaveBeenCalled();
 });
 it("rejects a range above 93 days before requesting metrics",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(panel(client));await screen.findByText("Campanha A");const before=f.invoke.mock.calls.length;
  fireEvent.change(screen.getByLabelText("De",{exact:true}),{target:{value:"2020-01-01"}});await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("até 93 dias"));expect(f.invoke.mock.calls).toHaveLength(before);
 });
});
