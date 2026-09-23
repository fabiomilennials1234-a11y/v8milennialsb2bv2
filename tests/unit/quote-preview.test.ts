import { describe, expect, it } from 'vitest';
import { buildPreviewTools, formatToolCallsForDryRun } from '../../src/lib/copilot/dry-run-engine';

describe('global quote preview', () => {
  const config = { templateDocumentId: 'template', fields: ['customer'], requiredFields: 'customer', convertToPdf: false };
  it('does not expose a disabled tool or an unconfigured template', () => {
    expect(buildPreviewTools({ GERAR_ORCAMENTO_PDF: { enabled: false, config, instruction: '' } })).toEqual([]);
    expect(buildPreviewTools({ GERAR_ORCAMENTO_PDF: { enabled: true, config: {}, instruction: '' } })).toEqual([]);
  });
  it('exposes the configured tool without organization allowlists', () => {
    const tools = buildPreviewTools({ GERAR_ORCAMENTO_PDF: { enabled: true, config, instruction: '' } });
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe('generate_order_request');
    expect(tools[0].function.description).toContain('não há arquivo nem envio real');
  });
  it('labels quote calls as simulated, not delivered', () => {
    const [call] = formatToolCallsForDryRun([{ function: { name: 'generate_order_request', arguments: '{"operation":"send"}' } }]);
    expect(call.humanDescription).toContain('nenhum arquivo gerado ou enviado');
  });
});
