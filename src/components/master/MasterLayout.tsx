/**
 * Layout específico para área Master
 *
 * Inclui sidebar própria e header com indicador de modo Master.
 */

import { Outlet } from "react-router-dom";
import { MasterSidebar } from "./MasterSidebar";
import { Shield } from "lucide-react";

export function MasterLayout() {
  return (
    <div className="flex h-screen bg-background">
      <MasterSidebar />
      
      <main className="flex-1 overflow-y-auto">
        {/* Master Mode Indicator */}
        <div className="sticky top-0 z-10 bg-red-600 text-white px-4 py-1.5 flex items-center justify-center gap-2 text-sm font-medium">
          <Shield className="w-4 h-4" />
          <span>Modo Master Admin - Acesso Total ao Sistema</span>
        </div>
        
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
