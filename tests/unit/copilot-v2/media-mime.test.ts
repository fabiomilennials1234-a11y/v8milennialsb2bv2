/**
 * Slice 6 — media-mime: kind → messageType do adapter + validação MIME (Copilot v2)
 *
 * Centraliza a heurística multi-camada da v1 (send-document.ts file_type OR
 * mime.startsWith) num mapeamento único. Áudio é ptt (ogg/opus). Fail-CLOSED:
 * MIME fora da allow-list do tipo → valid:false (o handler vira fallback
 * explícito, nunca silent-drop).
 */
import { describe, it, expect } from 'vitest';
import { resolveMediaDelivery, SEND_MEDIA_MIME } from '../../../supabase/functions/_shared/copilot-v2/media-mime.ts';

describe('resolveMediaDelivery', () => {
  it('mapeia image → messageType image', () => {
    expect(resolveMediaDelivery('image', 'image/png')).toEqual({ messageType: 'image', valid: true });
  });
  it('mapeia video → messageType video', () => {
    expect(resolveMediaDelivery('video', 'video/mp4')).toEqual({ messageType: 'video', valid: true });
  });
  it('mapeia audio(ptt) → messageType audio (ogg/opus)', () => {
    expect(resolveMediaDelivery('audio', 'audio/ogg; codecs=opus')).toEqual({ messageType: 'audio', valid: true });
  });
  it('aceita kind sem mimeType (valida pelo kind, MIME default do bucket)', () => {
    expect(resolveMediaDelivery('audio', null)).toEqual({ messageType: 'audio', valid: true });
  });
  it('fail-CLOSED: MIME que não casa com o kind → valid:false', () => {
    expect(resolveMediaDelivery('image', 'application/pdf')).toEqual({ messageType: 'image', valid: false });
  });
  it('fail-CLOSED: kind desconhecido → valid:false', () => {
    expect(resolveMediaDelivery('doc' as any, 'application/pdf')).toMatchObject({ valid: false });
  });
  it('expõe a allow-list por kind (mesma do bucket)', () => {
    expect(SEND_MEDIA_MIME.audio).toContain('audio/ogg');
    expect(SEND_MEDIA_MIME).not.toHaveProperty('pdf'); // KB-only, nunca send-media
  });
});
