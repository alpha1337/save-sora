import * as Dialog from "@radix-ui/react-dialog";
import DatePicker from "react-datepicker";
import { Button } from "@components/atoms/button";
import { Switch } from "@components/atoms/switch";
import { formatDateInput, isFetchRangeConfigured, parseDateInput } from "@app/utils/app-helpers";
import type { DateRangePreset } from "types/domain";

const DATE_RANGE_OPTIONS: Array<{ label: string; value: DateRangePreset }> = [
  { label: "Today", value: "24h" },
  { label: "This week", value: "7d" },
  { label: "Last 30 days", value: "1m" },
  { label: "Last 3 months", value: "3m" },
  { label: "All time", value: "all" },
  { label: "Custom", value: "custom" }
];

interface FetchDateRangeDialogProps {
  customEnd: string;
  customStart: string;
  onCustomEndChange: (value: string) => void;
  onCustomStartChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onPresetChange: (preset: DateRangePreset) => void;
  onRememberChoiceChange: (remember: boolean) => void;
  onSubmit: () => void;
  open: boolean;
  preset: DateRangePreset;
  rememberChoice: boolean;
}

export function FetchDateRangeDialog({
  customEnd,
  customStart,
  onCustomEndChange,
  onCustomStartChange,
  onOpenChange,
  onPresetChange,
  onRememberChoiceChange,
  onSubmit,
  open,
  preset,
  rememberChoice
}: FetchDateRangeDialogProps) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="ss-dialog-overlay" />
        <Dialog.Content className="ss-dialog-content">
          <Dialog.Title>Choose Fetch Date Range</Dialog.Title>
          <Dialog.Description>Select the time window for this fetch run, then submit to continue.</Dialog.Description>
          <div className="ss-stack">
            <div className="ss-date-preset-grid" role="radiogroup" aria-label="Fetch date range presets">
              {DATE_RANGE_OPTIONS.map((option) => (
                <button
                  aria-checked={preset === option.value}
                  className="ss-date-preset-button"
                  data-selected={preset === option.value}
                  key={option.value}
                  onClick={() => onPresetChange(option.value)}
                  role="radio"
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            {preset === "custom" ? (
              <div className="ss-date-picker-row">
                <DatePicker
                  calendarClassName="ss-react-datepicker"
                  className="ss-input"
                  dateFormat="yyyy-MM-dd"
                  onChange={(value: Date | null) => onCustomStartChange(formatDateInput(value))}
                  placeholderText="Start date"
                  selected={parseDateInput(customStart)}
                />
                <DatePicker
                  calendarClassName="ss-react-datepicker"
                  className="ss-input"
                  dateFormat="yyyy-MM-dd"
                  minDate={parseDateInput(customStart)}
                  onChange={(value: Date | null) => onCustomEndChange(formatDateInput(value))}
                  placeholderText="End date"
                  selected={parseDateInput(customEnd)}
                />
              </div>
            ) : null}
            <div className="ss-settings-toggle-card ss-settings-toggle-card--compact">
              <div className="ss-settings-toggle-row">
                <div className="ss-settings-toggle-copy">
                  <span className="ss-settings-toggle-label">Remember this choice?</span>
                  <span className="ss-settings-toggle-status" data-state={rememberChoice ? "enabled" : "disabled"}>
                    {rememberChoice ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <Switch
                  ariaLabel="Remember selected fetch date range"
                  checked={rememberChoice}
                  id="fetch-date-remember-choice"
                  onCheckedChange={onRememberChoiceChange}
                />
              </div>
              <p className="ss-muted">If enabled, future fetches will skip this dialog and use the saved range.</p>
            </div>
          </div>
          <div className="ss-inline-actions ss-dialog-footer-actions">
            <Dialog.Close asChild>
              <Button tone="secondary" type="button">Cancel</Button>
            </Dialog.Close>
            <Button disabled={!isFetchRangeConfigured(preset, customStart, customEnd)} onClick={onSubmit} type="button">
              Submit and Fetch
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
