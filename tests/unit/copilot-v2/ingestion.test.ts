/**
 * Slice 7 — FSM de ingestão pura (Copilot v2)
 *
 * A transição de status é determinística e SEMPRE sai de 'ingesting': sucesso
 * com chunks -> 'ready'; qualquer falha (extração vazia / embedding) -> 'failed'
 * com motivo. Nunca fica preso em 'ingesting' (lição VitrineVET). A escolha do
 * extrator é por source_kind/mime.
 */
import { describe, it, expect } from 'vitest';
import {
  decideIngestionExtractor,
  nextIngestionStatus,
  type IngestionOutcome,
} from '../../../supabase/functions/_shared/copilot-v2/ingestion.ts';

describe('decideIngestionExtractor', () => {
  it('rota pdf/doc para extração multimodal de texto', () => {
    expect(decideIngestionExtractor('pdf', 'application/pdf')).toBe('multimodal_text');
    expect(decideIngestionExtractor('doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx_text');
  });
  it('rota imagem para OCR/caption multimodal', () => {
    expect(decideIngestionExtractor('image', 'image/png')).toBe('multimodal_ocr');
  });
  it('rota vídeo para transcrição', () => {
    expect(decideIngestionExtractor('video', 'video/mp4')).toBe('transcript');
  });
});

describe('nextIngestionStatus — determinístico, nunca preso em ingesting', () => {
  it('sucesso com chunks -> ready', () => {
    const out: IngestionOutcome = { chunksStored: 4, error: null };
    expect(nextIngestionStatus(out)).toEqual({ status: 'ready', error_message: null });
  });
  it('extração vazia -> failed (não silencioso)', () => {
    const out: IngestionOutcome = { chunksStored: 0, error: 'texto extraído vazio' };
    expect(nextIngestionStatus(out)).toEqual({ status: 'failed', error_message: 'texto extraído vazio' });
  });
  it('falha de embedding -> failed com motivo (não silencioso)', () => {
    const out: IngestionOutcome = { chunksStored: 0, error: 'embedding 401: missing OPENROUTER_API_KEY' };
    expect(nextIngestionStatus(out)).toMatchObject({ status: 'failed' });
    expect(nextIngestionStatus(out).error_message).toContain('401');
  });
  it('zero chunks SEM erro explícito ainda é failed (fail-closed)', () => {
    const out: IngestionOutcome = { chunksStored: 0, error: null };
    expect(nextIngestionStatus(out)).toMatchObject({ status: 'failed' });
  });
});
