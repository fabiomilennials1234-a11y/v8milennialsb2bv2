import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton mirroring the real modal layout (#305) — avatar circle,
 * 2-line name, single company line, toolbar strip, then the two
 * columns (cross-pipe + activity).
 *
 * Structured so the loading state doesn't shift layout when the real
 * content arrives. Proportional to the actual header/columns.
 */
export function LeadModalSkeleton() {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="p-6 border-b border-border/40">
        <div className="flex items-start gap-4">
          <Skeleton className="w-14 h-14 rounded-full shrink-0" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-border/40 flex items-center gap-2">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-8 rounded-md ml-auto" />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-12 flex-1 min-h-0">
        <div className="col-span-12 md:col-span-7 p-6 space-y-4 border-r border-border/40">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <div className="col-span-12 md:col-span-5 p-6 space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}
