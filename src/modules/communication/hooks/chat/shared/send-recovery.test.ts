import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWithBoundedRecovery } from './send-recovery';
afterEach(() => vi.useRealTimers());
describe('bounded message recovery', () => {
  it('stops at ten send attempts, without an eleventh send', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue({data:null,error:{context:{status:429}}});
    const onRetry=vi.fn();
    const outcome=sendWithBoundedRecovery({send,confirm:async()=>null,onRetry,timeoutMs:100,retryDelayMs:1}).catch(e=>e);
    await vi.runAllTimersAsync();
    expect((await outcome).message).toBe('Falha no envio');
    expect(send).toHaveBeenCalledTimes(10); // initial send is part of the budget
    expect(onRetry.mock.calls.map(c=>c[0])).toEqual([1,2,3,4,5,6,7,8,9,10]);
  });
  it('keeps a slow accepted send in flight instead of duplicating it', async () => {
    vi.useFakeTimers();
    const send=vi.fn(()=>new Promise<{data:{result:{message_id:string}},error:null}>(resolve=>setTimeout(()=>resolve({data:{result:{message_id:'real'}},error:null}),15)));
    const result=sendWithBoundedRecovery({send,confirm:async()=>null,onRetry:vi.fn(),timeoutMs:10,retryDelayMs:3});
    await vi.runAllTimersAsync();
    expect((await result).data).toEqual({result:{message_id:'real'}});
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('stops recovery as soon as the webhook confirms delivery', async () => {
    const send=vi.fn().mockResolvedValue({data:null,error:new Error('network')});
    const confirmed={data:{result:{message_id:'confirmed'}},error:null};
    expect(await sendWithBoundedRecovery({send,confirm:async()=>confirmed,onRetry:vi.fn(),timeoutMs:1})).toEqual(confirmed);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('does not replay an ambiguous 500 and cannot loop after exhaustion', async () => {
    vi.useFakeTimers();
    const send=vi.fn().mockResolvedValue({data:null,error:{context:{status:500}}});
    const result=sendWithBoundedRecovery({send,confirm:async()=>null,onRetry:vi.fn(),timeoutMs:1,retryDelayMs:1}).catch(e=>e);
    await vi.runAllTimersAsync();
    expect((await result).retryAttempts).toBe(10);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
