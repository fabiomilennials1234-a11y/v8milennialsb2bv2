import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnectMeta } from "@/modules/communication/hooks/useMetaConnection";
const f=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@/modules/identity",()=>({useOrganization:()=>({organizationId:"org-a"}),useAuth:()=>({user:{id:"user"}})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{functions:{invoke:f.invoke}}}));
const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
beforeEach(()=>{vi.clearAllMocks();});
describe("server-issued Meta dialog",()=>{
 it("does not reflect transport errors or navigate to a non-Meta URL",async()=>{
  f.invoke.mockResolvedValue({error:new Error("private implementation error"),data:null});const {result}=renderHook(()=>useConnectMeta(),{wrapper});
  await expect(result.current.mutateAsync("facebook")).rejects.toThrow("Integração Meta indisponível");
  f.invoke.mockResolvedValue({error:null,data:{state:"signed",loginUrl:"https://evil.test/steal"}});await expect(result.current.mutateAsync("facebook")).rejects.toThrow("Não foi possível abrir");
 });
 it("forwards the validated org and explicit permission re-request, with no client app/config IDs",async()=>{
  f.invoke.mockResolvedValue({error:null,data:{state:"signed",loginUrl:"invalid"}});const {result}=renderHook(()=>useConnectMeta(),{wrapper});
  await expect(result.current.mutateAsync({connectionType:"instagram",authType:"rerequest"})).rejects.toThrow("Não foi possível abrir");
  expect(f.invoke).toHaveBeenCalledWith("meta-oauth-start",{body:{connectionType:"instagram",organization_id:"org-a",authType:"rerequest"}});
 });
});
