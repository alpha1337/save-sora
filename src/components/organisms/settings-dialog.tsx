import * as Dialog from "@radix-ui/react-dialog";
import type { Dispatch, SetStateAction } from "react";
import DatePicker from "react-datepicker";
import { FolderOpen, Trash2, X } from "lucide-react";
import type { AppSettings, DateRangePreset } from "types/domain";
import { Button } from "@components/atoms/button";
import { Input } from "@components/atoms/input";
import { Switch } from "@components/atoms/switch";
import { formatDateInput, parseDateInput } from "@app/utils/app-helpers";
import "@app/settings-modal.css";

interface SettingsDialogProps {
  backgroundVideoSrc: string;
  choosingDownloadDirectory: boolean;
  directoryPickerSupported: boolean;
  iconSrc: string;
  onChooseDownloadDirectory: () => void;
  onClearDownloadDirectory: () => void;
  onClearDownloadHistory: () => void;
  onClearFetchDatabase: () => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onSettingsDraftChange: Dispatch<SetStateAction<AppSettings>>;
  open: boolean;
  rememberedCustomDateEnd: string;
  rememberedCustomDateStart: string;
  rememberedDatePreset: DateRangePreset;
  settingsDraft: AppSettings;
}

export function SettingsDialog({
  backgroundVideoSrc,
  choosingDownloadDirectory,
  directoryPickerSupported,
  iconSrc,
  onChooseDownloadDirectory,
  onClearDownloadDirectory,
  onClearDownloadHistory,
  onClearFetchDatabase,
  onOpenChange,
  onSave,
  onSettingsDraftChange,
  open,
  rememberedCustomDateEnd,
  rememberedCustomDateStart,
  rememberedDatePreset,
  settingsDraft
}: SettingsDialogProps) {
  const downloadDirectoryName = settingsDraft.download_directory_name.trim();

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="ss-dialog-overlay ss-settings-takeover-overlay" />
        <Dialog.Content className="ss-dialog-content ss-settings-takeover-content">
          <div className="ss-settings-takeover-backdrop" aria-hidden="true">
            <video
              autoPlay
              className="ss-settings-takeover-video"
              loop
              muted
              playsInline
              preload="auto"
              src={backgroundVideoSrc}
            />
            <div className="ss-settings-takeover-video-overlay" />
          </div>
          <div className="ss-settings-takeover-panel">
            <div className="ss-settings-takeover-header">
              <img alt="" aria-hidden="true" className="ss-settings-takeover-icon" src={iconSrc} />
              <div className="ss-settings-takeover-title-wrap">
                <Dialog.Title className="ss-settings-modal-title">Settings</Dialog.Title>
                <Dialog.Description className="ss-settings-modal-description">
                  What would you like your zip file to be named?
                </Dialog.Description>
              </div>
            </div>
            <div className="ss-stack">
              <label className="ss-stack">
                <span className="ss-settings-name-label">ZIP file name</span>
                <Input
                  onChange={(event) =>
                    onSettingsDraftChange((current) => ({
                      ...current,
                      archive_name_template: event.target.value
                    }))
                  }
                  value={settingsDraft.archive_name_template}
                />
              </label>
              <div className="ss-settings-toggle-card">
                <div className="ss-settings-directory-row">
                  <div className="ss-settings-toggle-copy">
                    <span className="ss-settings-toggle-label">ZIP save folder</span>
                    <span className="ss-settings-directory-name">
                      {downloadDirectoryName || "Browser downloads"}
                    </span>
                  </div>
                  <div className="ss-settings-directory-actions">
                    {downloadDirectoryName ? (
                      <Button
                        aria-label="Clear ZIP save folder"
                        onClick={onClearDownloadDirectory}
                        tone="secondary"
                        type="button"
                      >
                        <X size={16} />
                      </Button>
                    ) : null}
                    <Button
                      disabled={!directoryPickerSupported || choosingDownloadDirectory}
                      onClick={onChooseDownloadDirectory}
                      tone="secondary"
                      type="button"
                    >
                      <FolderOpen size={16} />
                      {choosingDownloadDirectory ? "Choosing…" : "Choose Folder"}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="ss-settings-toggle-card">
                <div className="ss-settings-toggle-row">
                  <div className="ss-settings-toggle-copy">
                    <span className="ss-settings-toggle-label">Retry previously failed watermark removals?</span>
                    <span
                      className="ss-settings-toggle-status"
                      data-state={settingsDraft.retry_failed_watermark_removals === true ? "enabled" : "disabled"}
                    >
                      {settingsDraft.retry_failed_watermark_removals === true ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <Switch
                    ariaLabel="Retry previously failed watermark removals"
                    checked={settingsDraft.retry_failed_watermark_removals === true}
                    id="settings-retry-failed-watermark-removals"
                    onCheckedChange={(checked) =>
                      onSettingsDraftChange((current) => ({
                        ...current,
                        retry_failed_watermark_removals: checked
                      }))
                    }
                  />
                </div>
                <p className="ss-muted">When disabled, resume skips videos that already fell back to watermarked sources.</p>
              </div>
              <div className="ss-settings-toggle-card">
                <div className="ss-settings-toggle-row">
                  <div className="ss-settings-toggle-copy">
                    <span className="ss-settings-toggle-label">Enable Database?</span>
                    <span
                      className="ss-settings-toggle-status"
                      data-state={settingsDraft.enable_fetch_resume === true ? "enabled" : "disabled"}
                    >
                      {settingsDraft.enable_fetch_resume === true ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <Switch
                    ariaLabel="Enable database cache and resume checkpoints"
                    checked={settingsDraft.enable_fetch_resume === true}
                    id="settings-enable-fetch-resume"
                    onCheckedChange={(checked) =>
                      onSettingsDraftChange((current) => ({
                        ...current,
                        enable_fetch_resume: checked
                      }))
                    }
                  />
                </div>
                <p className="ss-muted">Loads saved rows and resumes checkpoints.</p>
              </div>
              <div className="ss-settings-toggle-card">
                <div className="ss-settings-toggle-row">
                  <div className="ss-settings-toggle-copy">
                    <span className="ss-settings-toggle-label">Remember fetch date?</span>
                    <span
                      className="ss-settings-toggle-status"
                      data-state={settingsDraft.remember_fetch_date_choice === true ? "enabled" : "disabled"}
                    >
                      {settingsDraft.remember_fetch_date_choice === true ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <Switch
                    ariaLabel="Remember selected fetch date range and skip date prompt"
                    checked={settingsDraft.remember_fetch_date_choice === true}
                    id="settings-remember-fetch-date-choice"
                    onCheckedChange={(checked) =>
                      onSettingsDraftChange((current) => ({
                        ...current,
                        remember_fetch_date_choice: checked
                      }))
                    }
                  />
                </div>
                <p className="ss-muted">Select the saved range used when the fetch date prompt is skipped.</p>
                <div className="ss-date-preset-grid" aria-label="Remembered fetch date range" role="radiogroup">
                  {[
                    { label: "Today", value: "24h" },
                    { label: "This week", value: "7d" },
                    { label: "Last 30 days", value: "1m" },
                    { label: "Last 3 months", value: "3m" },
                    { label: "All time", value: "all" },
                    { label: "Custom", value: "custom" }
                  ].map((option) => (
                    <button
                      aria-checked={rememberedDatePreset === option.value}
                      className="ss-date-preset-button"
                      data-selected={rememberedDatePreset === option.value}
                      key={`settings-${option.value}`}
                      onClick={() =>
                        onSettingsDraftChange((current) => ({
                          ...current,
                          remembered_date_range_preset: option.value as DateRangePreset
                        }))
                      }
                      role="radio"
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {rememberedDatePreset === "custom" ? (
                  <div className="ss-date-picker-row">
                    <DatePicker
                      calendarClassName="ss-react-datepicker"
                      className="ss-input"
                      dateFormat="yyyy-MM-dd"
                      onChange={(value: Date | null) =>
                        onSettingsDraftChange((current) => ({
                          ...current,
                          remembered_custom_date_start: formatDateInput(value)
                        }))
                      }
                      placeholderText="Start date"
                      selected={parseDateInput(rememberedCustomDateStart)}
                    />
                    <DatePicker
                      calendarClassName="ss-react-datepicker"
                      className="ss-input"
                      dateFormat="yyyy-MM-dd"
                      minDate={parseDateInput(rememberedCustomDateStart)}
                      onChange={(value: Date | null) =>
                        onSettingsDraftChange((current) => ({
                          ...current,
                          remembered_custom_date_end: formatDateInput(value)
                        }))
                      }
                      placeholderText="End date"
                      selected={parseDateInput(rememberedCustomDateEnd)}
                    />
                  </div>
                ) : null}
              </div>
              <div className="ss-settings-actions-row">
                <Button onClick={onClearFetchDatabase} tone="warning" type="button">
                  <Trash2 size={16} />
                  Clear Fetch Database
                </Button>
                <Button onClick={onClearDownloadHistory} tone="danger" type="button">
                  <Trash2 size={16} />
                  Clear Download History
                </Button>
              </div>
            </div>
            <div className="ss-settings-actions-row">
              <Dialog.Close asChild>
                <Button tone="secondary" type="button">Cancel</Button>
              </Dialog.Close>
              <Button onClick={onSave} type="button">
                Save Settings
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
