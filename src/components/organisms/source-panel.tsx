import { RefreshCcw, Square } from "lucide-react";
import type { CharacterAccount, CreatorProfile, SourceSelectionState, TopLevelSourceType } from "types/domain";
import { Button } from "@components/atoms/button";
import { Panel } from "@components/atoms/panel";
import { CreatorProfileManager } from "@components/molecules/creator-profile-manager";
import { CharacterAccountSelector } from "@components/molecules/character-account-selector";
import { SourceSelector } from "@components/molecules/source-selector";

interface SourcePanelProps {
  characterAccounts: CharacterAccount[];
  creatorProfiles: CreatorProfile[];
  creatorRouteInput: string;
  isFetching?: boolean;
  disabled?: boolean;
  selectedCharacterAccountIds: string[];
  sourceSelections: SourceSelectionState;
  onAddCreatorProfile: () => void;
  onFetch: () => void;
  onCancelFetch: () => void;
  onCreatorRouteInputChange: (value: string) => void;
  onLoadCharacterAccounts: () => void;
  onRemoveCreatorProfile: (profileId: string) => void;
  onToggleCharacterAccount: (accountId: string, checked: boolean) => void;
  onToggleSource: (source: TopLevelSourceType, checked: boolean) => void;
}

/**
 * Left-hand source configuration surface.
 */
export function SourcePanel(props: SourcePanelProps) {
  const isFetching = props.isFetching ?? false;

  return (
    <Panel className="ss-stack">
      <div>
        <h2>Sources</h2>
        <p className="ss-muted">
          Pick one or more source groups, then fetch normalized rows into the local session store. Saved creators expand into
          published plus cameo jobs unless the saved creator is a character, in which case it expands into appearances and drafts.
          Character accounts expand into appearances and drafts only.
        </p>
      </div>
      <SourceSelector disabled={props.disabled} onToggleSource={props.onToggleSource} sourceSelections={props.sourceSelections} />
      <div>
        <h3>Fetch</h3>
        <p className="ss-muted">Click fetch to choose date range and start processing.</p>
        <div className="ss-fetch-step-actions">
          <Button disabled={props.disabled} onClick={props.onFetch} type="button">
            <RefreshCcw size={16} />
            Fetch Videos
          </Button>
          {isFetching ? (
            <Button onClick={props.onCancelFetch} tone="danger" type="button">
              <Square size={16} />
              Cancel Fetch
            </Button>
          ) : null}
        </div>
      </div>
      <div>
        <h3>Saved Creators</h3>
        <CreatorProfileManager
          creatorProfiles={props.creatorProfiles}
          creatorRouteInput={props.creatorRouteInput}
          disabled={props.disabled}
          onAddCreatorProfile={props.onAddCreatorProfile}
          onCreatorRouteInputChange={props.onCreatorRouteInputChange}
          onRemoveCreatorProfile={props.onRemoveCreatorProfile}
        />
      </div>
      <div>
        <h3>Character Accounts</h3>
        <CharacterAccountSelector
          accounts={props.characterAccounts}
          disabled={props.disabled}
          onLoadAccounts={props.onLoadCharacterAccounts}
          onSetSelectedAccountIds={(accountIds) => {
            const selectedIdSet = new Set(props.selectedCharacterAccountIds);
            const nextIdSet = new Set(accountIds);
            for (const accountId of props.selectedCharacterAccountIds) {
              if (!nextIdSet.has(accountId)) {
                props.onToggleCharacterAccount(accountId, false);
              }
            }
            for (const accountId of accountIds) {
              if (!selectedIdSet.has(accountId)) {
                props.onToggleCharacterAccount(accountId, true);
              }
            }
          }}
          onToggleAccount={props.onToggleCharacterAccount}
          selectedAccountIds={props.selectedCharacterAccountIds}
        />
      </div>
    </Panel>
  );
}
