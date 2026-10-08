export interface UazapiPixFields {
 raw_payload?: unknown;
 uazapi_pix_key?: unknown;
 uazapi_pix_name?: unknown;
 uazapi_pix_type?: unknown;
 uazapi_native_buttons?: unknown;
}
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length <= max ? v.trim() : '';
export function readUazapiPix(fields: UazapiPixFields) {
 const raw=obj(fields.raw_payload), send=obj(raw.sendPayload), content=obj(raw.content);
 let key=str(fields.uazapi_pix_key ?? send.pixKey, 256), name=str(fields.uazapi_pix_name ?? send.pixName, 256), type=str(fields.uazapi_pix_type ?? send.pixType, 32);
 if (!key) {
  const buttons=fields.uazapi_native_buttons ?? obj(obj(content.InteractiveMessage).NativeFlowMessage).buttons;
  if (Array.isArray(buttons)) for(const candidate of buttons.slice(0,20)) {
   const button=obj(candidate); if(button.name!=='payment_info'||typeof button.buttonParamsJSON!=='string'||button.buttonParamsJSON.length>16384)continue;
   try {
    const data=obj(JSON.parse(button.buttonParamsJSON));
    if(!Array.isArray(data.payment_settings))continue;
    for(const setting of data.payment_settings.slice(0,10)) {
     const pix=obj(obj(setting).pix_static_code);
     key=str(pix.key,256);name=str(pix.merchant_name,256);type=str(pix.key_type,32);
     if(key)break;
    }
   }catch{continue;}
   if(key)break;
  }
 }
 return key && name ? {key,name,type} : null;
}
