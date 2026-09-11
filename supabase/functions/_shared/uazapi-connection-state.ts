/** Persist only states accepted by the instance table; hibernation keeps credentials. */
export function storedUazapiConnectionState(value: unknown): 'connected' | 'connecting' | 'disconnected' | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value.toLowerCase()) {
    case 'connected': case 'open': return 'connected';
    case 'connecting': return 'connecting';
    case 'disconnected': case 'closed': case 'close': case 'hibernated': return 'disconnected';
    default: return undefined;
  }
}
