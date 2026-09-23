import { afterEach, describe, expect, it, vi } from 'vitest';
import { quoteLiveSendEnabled } from '../../supabase/functions/_shared/quotes/live-send';
import { needsConcurrencyGuard } from '../../supabase/functions/_shared/copilot/concurrency-guard';
afterEach(()=>vi.unstubAllGlobals());
describe('scoped quote rollout',()=>{
  it('enables only the exact trusted organization and keeps default closed',()=>{
    vi.stubGlobal('Deno',{env:{get:(key:string)=>key==='COPILOT_QUOTE_LIVE_SEND_ORG_IDS'?'org-a, org-b':undefined}});
    expect(quoteLiveSendEnabled('org-a')).toBe(true);
    expect(quoteLiveSendEnabled('org-b')).toBe(true);
    expect(quoteLiveSendEnabled('org')).toBe(false);
    expect(quoteLiveSendEnabled('org-c')).toBe(false);
    expect(quoteLiveSendEnabled()).toBe(false);
  });
  it('does not reintroduce media starvation for quote delivery',()=>{
    expect(needsConcurrencyGuard('send_quote_document')).toBe(false);
    expect(needsConcurrencyGuard('update_lead')).toBe(true);
  });
});
