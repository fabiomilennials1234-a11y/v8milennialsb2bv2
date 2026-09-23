import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuoteTemplateConfig } from '@/modules/copilot/components/playground/QuoteTemplateConfig';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),error:vi.fn(),success:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('sonner',()=>({toast:{error:mocks.error,success:mocks.success}}));
beforeEach(()=>{cleanup();vi.clearAllMocks();});
describe('quote tool settings',()=>{
  it('requires a saved agent before importing',()=>{
    render(<QuoteTemplateConfig config={{}} onChange={vi.fn()}/>);
    expect(screen.getByLabelText('Importar modelo Word')).toBeDisabled();
    expect(screen.getByRole('switch')).toBeDisabled();
  });
  it('persists false directly when switching off PDF',()=>{
    const onChange=vi.fn();
    render(<QuoteTemplateConfig agentId="agent" config={{convertToPdf:true}} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith({convertToPdf:false});
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('requires a healthy converter before enabling PDF',async()=>{
    mocks.invoke.mockResolvedValue({data:{pdf:false},error:null});
    const onChange=vi.fn();
    render(<QuoteTemplateConfig agentId="agent" config={{convertToPdf:false}} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(()=>expect(mocks.error).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith('copilot-quote-template',{body:{action:'health',agent_id:'agent'}});
  });
  it('enables PDF after a successful health check',async()=>{
    mocks.invoke.mockResolvedValue({data:{pdf:true},error:null});
    const onChange=vi.fn();
    render(<QuoteTemplateConfig agentId="agent" config={{}} onChange={onChange}/>);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(()=>expect(onChange).toHaveBeenCalledWith({convertToPdf:true}));
  });
  it('refuses a non-Word file before transmitting anything',()=>{
    render(<QuoteTemplateConfig agentId="agent" config={{}} onChange={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('Importar modelo Word'),{target:{files:[new File(['x'],'invoice.pdf',{type:'application/pdf'})]}});
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
