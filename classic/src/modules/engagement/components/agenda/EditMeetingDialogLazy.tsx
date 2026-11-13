import { lazy, Suspense, type ComponentProps } from "react";
import type { EditMeetingDialog as DialogReal } from "./EditMeetingDialog";

const Real = lazy(() => import("./EditMeetingDialog").then((m) => ({ default: m.EditMeetingDialog })));

/** Mantém o editor e seus pickers fora do carregamento inicial do chat. */
export function EditMeetingDialog(props: ComponentProps<typeof DialogReal>) {
  if (!props.open) return null;
  return <Suspense fallback={null}><Real {...props} /></Suspense>;
}
