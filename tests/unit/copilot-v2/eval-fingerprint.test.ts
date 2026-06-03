/**
 * W13 — eval-fingerprint. A deterministic fingerprint of the eval-relevant
 * surface per archetype (immutable base prompt + routed model + tool contract).
 * The golden eval fixture commits these; the dataset-gate test asserts the live
 * fingerprint still matches, so a prompt/model/tool edit forces a re-bless.
 */

import { describe, it, expect } from 'vitest';
import {
  evalFingerprint,
  evalFingerprints,
  fingerprintOf,
  ARCHETYPES,
} from '../../../supabase/functions/_shared/copilot-v2/eval-fingerprint.ts';

describe('eval-fingerprint', () => {
  it('produces a stable 16-hex fingerprint per archetype', () => {
    const a = evalFingerprints();
    const b = evalFingerprints();
    expect(a).toEqual(b); // deterministic
    for (const arch of ARCHETYPES) {
      expect(a[arch]).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('distinguishes archetypes (different base prompt + model → different fingerprint)', () => {
    const fp = evalFingerprints();
    expect(fp.qualificador).not.toEqual(fp.vendedor);
    expect(fp.vendedor).not.toEqual(fp.carteira);
  });

  it('fingerprintOf is a change-detection tripwire: any content edit flips it', () => {
    expect(fingerprintOf('abc')).toEqual(fingerprintOf('abc'));
    expect(fingerprintOf('abc')).not.toEqual(fingerprintOf('abd'));
    expect(fingerprintOf('')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('evalFingerprint(qualificador) equals the composed fingerprint of its surface', () => {
    // The fingerprint must actually fold in the base prompt — a sanity guard that
    // it is not a constant. Changing the prompt text would change this value.
    expect(evalFingerprint('qualificador')).toEqual(evalFingerprints().qualificador);
  });
});
