import type { PropsWithChildren, ReactNode } from "react";
import { Panel } from "@components/atoms/panel";

interface AppShellTemplateProps extends PropsWithChildren {
  header: ReactNode;
  sidebar?: ReactNode;
  sidebarCollapsed?: boolean;
}

/**
 * Fullscreen app template with a stable primary layout.
 */
export function AppShellTemplate({ children, header, sidebar, sidebarCollapsed = false }: AppShellTemplateProps) {
  const hasSidebar = Boolean(sidebar);
  const showSidebar = hasSidebar && !sidebarCollapsed;

  return (
    <div className="ss-shell">
      <Panel className="ss-shell-header">{header}</Panel>
      <div
        className={`ss-shell-body ${hasSidebar ? "" : "ss-shell-body--no-sidebar"} ${showSidebar ? "" : "ss-shell-body--sidebar-collapsed"}`.trim()}
      >
        {showSidebar ? <aside className="ss-shell-sidebar">{sidebar}</aside> : null}
        <main className="ss-shell-main">{children}</main>
      </div>
    </div>
  );
}
