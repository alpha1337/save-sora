import * as Tabs from "@radix-ui/react-tabs";
import type { PropsWithChildren, ReactNode } from "react";
import { Panel } from "@components/atoms/panel";

interface AppShellTemplateProps extends PropsWithChildren {
  header: ReactNode;
  sidebar: ReactNode;
  settings: ReactNode;
}

/**
 * Fullscreen app template with a stable tabbed primary layout.
 */
export function AppShellTemplate({ children, header, settings, sidebar }: AppShellTemplateProps) {
  return (
    <div className="ss-shell">
      <Panel className="ss-shell-header">{header}</Panel>
      <Tabs.Root className="ss-shell-body" defaultValue="results">
        <aside className="ss-shell-sidebar">{sidebar}</aside>
        <main className="ss-shell-main">
          <Tabs.List className="ss-tab-list">
            <Tabs.Trigger className="ss-tab-trigger" value="results">
              Results
            </Tabs.Trigger>
            <Tabs.Trigger className="ss-tab-trigger" value="settings">
              Settings
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content className="ss-tab-content" value="results">
            {children}
          </Tabs.Content>
          <Tabs.Content className="ss-tab-content" value="settings">
            {settings}
          </Tabs.Content>
        </main>
      </Tabs.Root>
    </div>
  );
}
