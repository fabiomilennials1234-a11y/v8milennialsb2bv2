import { describe,it,expect } from 'vitest';
import { readUazapiPix } from './uazapiPixDisplay';
describe('PIX display',()=>{
 it('reads narrow projection and realtime outbound metadata',()=>{
  const expected={key:'qa@example.test',name:'QA',type:'email'};
  expect(readUazapiPix({uazapi_pix_key:expected.key,uazapi_pix_name:'QA',uazapi_pix_type:'email'})).toEqual(expected);
  expect(readUazapiPix({raw_payload:{sendPayload:{pixKey:expected.key,pixName:'QA',pixType:'email'}}})).toEqual(expected);
 });
 it('reads actual native payment_info shape without treating order.status as payment proof',()=>{
  const buttons=[{name:'payment_info',buttonParamsJSON:JSON.stringify({order:{status:'paid'},payment_settings:[{pix_static_code:{key:'qa@example.test',merchant_name:'QA',key_type:'email'}}]})}];
  expect(readUazapiPix({uazapi_native_buttons:buttons})).toEqual({key:'qa@example.test',name:'QA',type:'email'});
 });
 it.each(['{','x'.repeat(17000)])('ignores invalid or oversized native JSON',value=>{expect(readUazapiPix({uazapi_native_buttons:[{name:'payment_info',buttonParamsJSON:value}]})).toBeNull();});
 it('requires key and receiver rather than guessing from text',()=>{expect(readUazapiPix({raw_payload:{text:'PIX paid',sendPayload:{pixKey:'test'}}})).toBeNull();});
});
