import {describe,it,expect} from 'vitest';
import {outboundMenuDisplay} from '../../supabase/functions/_shared/outbound-menu-display';
describe('outbound list display',()=>{
  it('preserves sections and descriptions without exposing route IDs',()=>{
    const display=outboundMenuDisplay({type:'list',choices:['[Serviços]','Validar|private-route|Conferir payload','[Fim]','Concluir'],listButtonLabel:'Abrir'},'Teste');
    expect(display?.content.sections).toEqual([{title:'Serviços',rows:[{title:'Validar',description:'Conferir payload'}]},{title:'Fim',rows:[{title:'Concluir',description:''}]}]);
    expect(JSON.stringify(display)).not.toContain('private-route');
    expect(display?.content.buttonText).toBe('Abrir');
  });
  it('does not interpret other menu types as lists',()=>{
    expect(outboundMenuDisplay({type:'carousel',choices:['[Cartão]']},'Teste')).toBeUndefined();
    expect(outboundMenuDisplay(undefined,null)).toBeUndefined();
  });
});
