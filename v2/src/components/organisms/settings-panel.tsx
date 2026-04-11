import * as Dialog from "@radix-ui/react-dialog";
import { RotateCcw, Settings, Trash2 } from "lucide-react";
import type { AppSettings } from "types/domain";
import { Button } from "@components/atoms/button";
import { Input } from "@components/atoms/input";
import { Panel } from "@components/atoms/panel";

interface SettingsPanelProps {
  settings: AppSettings;
  onArchiveNameTemplateChange: (value: string) => void;
  onClearDownloadHistory: () => void;
  onResetSession: () => void;
}

/**
 * Settings surface with the only permanent-history destructive action.
 */
export function SettingsPanel({ onArchiveNameTemplateChange, onClearDownloadHistory, onResetSession, settings }: SettingsPanelProps) {
  return (
    <Panel className="ss-stack">
      <div>
        <h2>
          <Settings size={18} />
          Settings
        </h2>
        <p className="ss-muted">Persistent settings plus the explicit history clear action.</p>
      </div>
      <label className="ss-stack">
        <span>Archive name template</span>
        <Input onChange={(event) => onArchiveNameTemplateChange(event.target.value)} value={settings.archive_name_template} />
      </label>
      <div className="ss-inline-actions">
        <Button onClick={onResetSession} tone="secondary" type="button">
          <RotateCcw size={16} />
          Reset Session
        </Button>
        <Dialog.Root>
          <Dialog.Trigger asChild>
            <Button tone="danger" type="button">
              <Trash2 size={16} />
              Clear Download History
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="ss-dialog-overlay" />
            <Dialog.Content className="ss-dialog-content">
              <Dialog.Title>Clear Download History</Dialog.Title>
              <Dialog.Description>
                This is the only code path that deletes permanent download history. Continue only if you want to remove every saved `video_id`.
              </Dialog.Description>
              <div className="ss-inline-actions">
                <Dialog.Close asChild>
                  <Button tone="secondary" type="button">Cancel</Button>
                </Dialog.Close>
                <Dialog.Close asChild>
                  <Button onClick={onClearDownloadHistory} tone="danger" type="button">Clear History</Button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </Panel>
  );
}
