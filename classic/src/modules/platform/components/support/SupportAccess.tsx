import type { ReactNode } from "react";
import { useSupportAvailable } from "./useSupportAvailable";

export function SupportAccess({ children }: { children: ReactNode }) {
  return useSupportAvailable() ? <>{children}</> : null;
}
