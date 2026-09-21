import { handleWorkflowQuestionImage } from "../_shared/workflow-question-image.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";

Deno.serve(withErrorBoundary("workflow-question-image", handleWorkflowQuestionImage));
