// src/components/chat-meta/ChatMetaSkeleton.tsx
import { Skeleton } from "@/components/ui/skeleton";

export function ChatMetaSkeleton() {
  return (
    <div className="grid h-full grid-cols-[320px_1fr_360px]">
      <div className="border-r p-3 space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="p-4 space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-3/4" />
        <Skeleton className="h-12 w-1/2 ml-auto" />
      </div>
      <div className="border-l p-3">
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
