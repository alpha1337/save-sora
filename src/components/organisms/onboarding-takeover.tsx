import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@components/atoms/button";
import { Switch } from "@components/atoms/switch";

interface OnboardingTakeoverProps {
  backgroundVideoSrc: string;
  enableDatabase: boolean;
  iconSrc: string;
  onEnableDatabaseChange: (enabled: boolean) => void;
  onSubmit: () => void;
  open: boolean;
}

/**
 * First-run setup gate. It blocks interaction until the user chooses persistence behavior.
 */
export function OnboardingTakeover({
  backgroundVideoSrc,
  enableDatabase,
  iconSrc,
  onEnableDatabaseChange,
  onSubmit,
  open
}: OnboardingTakeoverProps) {
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="ss-dialog-overlay ss-settings-takeover-overlay" />
        <Dialog.Content
          className="ss-dialog-content ss-settings-takeover-content"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
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
          <div className="ss-settings-takeover-panel ss-onboarding-panel">
            <div className="ss-settings-takeover-header">
              <img alt="" aria-hidden="true" className="ss-settings-takeover-icon" src={iconSrc} />
              <div className="ss-settings-takeover-title-wrap">
                <Dialog.Title className="ss-settings-modal-title">Set Up Save Sora</Dialog.Title>
                <Dialog.Description className="ss-settings-modal-description">
                  Choose whether this browser can keep a local database for faster resumes and downloaded badges.
                </Dialog.Description>
              </div>
            </div>
            <div className="ss-settings-toggle-card">
              <div className="ss-settings-toggle-row">
                <div className="ss-settings-toggle-copy">
                  <span className="ss-settings-toggle-label">Enable Database?</span>
                  <span className="ss-settings-toggle-status" data-state={enableDatabase ? "enabled" : "disabled"}>
                    {enableDatabase ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <Switch
                  ariaLabel="Enable local Save Sora database"
                  checked={enableDatabase}
                  id="onboarding-enable-database"
                  onCheckedChange={onEnableDatabaseChange}
                />
              </div>
              <p className="ss-muted">
                Local database storage is used for cached rows, checkpoints, downloaded badges, and faster resume.
              </p>
            </div>
            <Button onClick={onSubmit} type="button">Continue</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
