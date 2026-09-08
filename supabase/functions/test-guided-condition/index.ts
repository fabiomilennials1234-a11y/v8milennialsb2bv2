import { handleGuidedConditionTest } from '../_shared/guided-condition-test.ts';
import { withErrorBoundary } from '../_shared/error-boundary.ts';

Deno.serve(withErrorBoundary('test-guided-condition', handleGuidedConditionTest));
