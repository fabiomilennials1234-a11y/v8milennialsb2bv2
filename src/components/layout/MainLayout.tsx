import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { OrgSwitcher } from "./OrgSwitcher";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background" data-layout="main">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="flex items-center justify-end px-6 lg:px-8 pt-4">
          <OrgSwitcher />
        </div>
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
