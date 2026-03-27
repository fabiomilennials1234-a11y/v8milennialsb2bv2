import { ReactNode } from "react";
import { TopNavigation } from "./TopNavigation";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen bg-background" data-layout="main">
      <TopNavigation />
      <main className="flex-1 overflow-auto">
        <div className="px-6 lg:px-10 xl:px-12 py-6 lg:py-8 max-w-[1600px] mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
