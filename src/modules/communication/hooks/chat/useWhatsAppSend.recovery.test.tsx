import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFailedMessages, useSendWhatsAppMessage } from './useWhatsAppSend';
import { SendRetriesExhausted } from './shared/send-recovery';
const recovery=vi.hoisted(()=>vi.fn());
vi.mock('./shared/send-recovery',async importOriginal=>({ ...await importOriginal<typeof import('./shared/send-recovery')>(), sendWithBoundedRecovery: recovery }));
vi.mock('@/modules/identity',()=>({ useCurrentTeamMember:()=>({data:{id:'member',organization_id:'org'}}) }));
vi.mock('@/lib/analytics',()=>({track:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{metadata:{}},error:null})})})}),
 functions:{invoke:vi.fn()},
}}));
beforeEach(()=>vi.clearAllMocks());
describe('one failed send in chat cache',()=>{
 it('preserves new realtime messages when a send fails and keeps one stable failure',async()=>{
  const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  const key=['whatsapp_messages','org','5511999999999','instance'];
  qc.setQueryData(key,[]);
  let rejectSend!: (reason:unknown)=>void;
  recovery.mockImplementation(()=>new Promise((_,reject)=>{rejectSend=reject;}));
  const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const {result}=renderHook(()=>({send:useSendWhatsAppMessage(),failed:useFailedMessages('5511999999999','instance')}),{wrapper});
  let finished!:Promise<unknown>;
  act(()=>{finished=result.current.send.mutateAsync({phoneNumber:'5511999999999',instanceId:'instance',instanceName:'Main',message:'hello'}).catch(e=>e);});
  await waitFor(()=>expect(recovery).toHaveBeenCalledTimes(1));
  const pending=qc.getQueryData<Array<{id:string}>>(key)![0];
  act(()=>qc.setQueryData(key,(old:unknown[])=>[...old,{id:'new-realtime',content:'new incoming'}]));
  await act(async()=>{rejectSend(new SendRetriesExhausted());await finished;});
  await waitFor(()=>expect(result.current.failed).toHaveLength(1));
  expect(qc.getQueryData(key)).toEqual([{id:'new-realtime',content:'new incoming'}]);
  expect(result.current.failed[0]).toMatchObject({id:pending.id,status:'failed',retry_attempt:10});
  qc.clear();
 });
});
