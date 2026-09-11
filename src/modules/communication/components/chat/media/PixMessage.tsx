import { useState } from 'react';
import { Copy, Check, QrCode } from 'lucide-react';
export function PixMessage({ pix }: { pix: { key: string; name: string; type: string } }) {
 const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false);
 const copy=async()=>{try{await navigator.clipboard.writeText(pix.key);setCopied(true);setFailed(false);}catch{setFailed(true);}};
 return <div className="min-w-[200px] max-w-sm rounded-xl border border-current/15 p-3" aria-label="Chave PIX">
  <div className="flex items-center gap-2 text-xs font-medium"><QrCode className="h-4 w-4"/>PIX</div>
  <p className="mt-2 text-sm font-medium break-words">{pix.name}</p>
  <p className="mt-1 text-xs font-mono break-all opacity-75">{pix.key}</p>
  <button type="button" onClick={copy} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium">
   {copied?<Check className="h-3.5 w-3.5"/>:<Copy className="h-3.5 w-3.5"/>}{copied?'Chave copiada':'Copiar chave PIX'}
  </button>
  {failed&&<p role="alert" className="mt-1 text-xs">Selecione a chave acima para copiar.</p>}
 </div>;
}
