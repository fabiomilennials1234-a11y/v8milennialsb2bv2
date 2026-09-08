import { handleGuidedWorkflowPublication } from '../_shared/guided-workflow-publication.ts';
import { withErrorBoundary } from '../_shared/error-boundary.ts';

Deno.serve(withErrorBoundary('publish-guided-workflow', handleGuidedWorkflowPublication));
