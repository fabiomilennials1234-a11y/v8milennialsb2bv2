import { describe, it, expect, vi, beforeEach } from 'vitest';
const store = vi.hoisted(() => ({upload:vi.fn(),remove:vi.fn()}));
vi.mock('@/integrations/supabase/client', () => ({supabase:{storage:{from:vi.fn(() => store)}}}));
import { uploadCommentFiles } from '@/modules/leads/lib/comment-attachments/storage';
const context={organizationId:'org',entryId:'entry',userId:'user',commentId:'comment'};
beforeEach(() => { vi.clearAllMocks(); store.remove.mockResolvedValue({error:null}); });
describe('upload privado', () => {
 it('limpa uploads parciais ao falhar e propaga erro', async () => {
  store.upload.mockResolvedValueOnce({error:null}).mockResolvedValueOnce({error:new Error('offline')});
  await expect(uploadCommentFiles([new File(['a'],'a.pdf'),new File(['b'],'b.pdf')],context)).rejects.toThrow('offline');
  expect(store.remove).toHaveBeenCalledWith([expect.stringMatching(/^org\/entry\/user\/comment\/.*\.pdf$/)]);
 });
 it('não usa nome do documento no caminho e proíbe overwrite', async () => {
  store.upload.mockResolvedValue({error:null});
  const file = new File(['a'],'Contrato sigiloso.pdf');
  const result=await uploadCommentFiles([file],context);
  expect(result[0].path).not.toContain('Contrato');
  expect(store.upload).toHaveBeenCalledWith(result[0].path,file,{contentType:'application/pdf',upsert:false});
 });
 it('valida antes de enviar qualquer byte', async () => {
  await expect(uploadCommentFiles([new File(['x'],'run.exe')],context)).rejects.toThrow();
  expect(store.upload).not.toHaveBeenCalled();
 });
});
