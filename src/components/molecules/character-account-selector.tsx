import type { CharacterAccount } from "types/domain";
import { Button } from "@components/atoms/button";
import { Checkbox } from "@components/atoms/checkbox";
import { formatCount } from "@lib/utils/format-utils";

interface CharacterAccountSelectorProps {
  accounts: CharacterAccount[];
  disabled?: boolean;
  selectedAccountIds: string[];
  onLoadAccounts: () => void;
  onSetSelectedAccountIds: (accountIds: string[]) => void;
  onToggleAccount: (accountId: string, checked: boolean) => void;
}

/**
 * Character-account checklist with an explicit refresh action.
 */
export function CharacterAccountSelector({
  accounts,
  disabled = false,
  onLoadAccounts,
  onSetSelectedAccountIds,
  onToggleAccount,
  selectedAccountIds
}: CharacterAccountSelectorProps) {
  const selectedIdSet = new Set(selectedAccountIds);
  const selectableAccountIds = accounts.map((account) => account.account_id).filter(Boolean);
  const selectedCount = selectableAccountIds.filter((accountId) => selectedIdSet.has(accountId)).length;
  const allSelected = selectableAccountIds.length > 0 && selectedCount === selectableAccountIds.length;

  function handleSelectAll(): void {
    onSetSelectedAccountIds(selectableAccountIds);
  }

  function handleClearAll(): void {
    onSetSelectedAccountIds([]);
  }

  return (
    <div className="ss-stack">
      <Button disabled={disabled} onClick={onLoadAccounts} tone="secondary" type="button">
        Refresh Character Accounts
      </Button>
      <div className="ss-character-account-controls">
        <div className="ss-segmented-toggle" role="group" aria-label="Character account selection">
          <Button
            className="ss-segmented-toggle-button ss-segmented-toggle-button--primary"
            disabled={disabled || selectableAccountIds.length === 0 || allSelected}
            onClick={handleSelectAll}
            tone="default"
            type="button"
          >
            Select all
          </Button>
          <Button
            className="ss-segmented-toggle-button ss-segmented-toggle-button--secondary"
            disabled={disabled || selectedCount === 0}
            onClick={handleClearAll}
            tone="danger"
            type="button"
          >
            Select none
          </Button>
        </div>
      </div>
      <div className="ss-character-account-list">
        {accounts.map((account) => (
          <div className="ss-character-account-row" key={account.account_id}>
            <Checkbox
              checked={selectedAccountIds.includes(account.account_id)}
              disabled={disabled}
              id={`character-account-${account.account_id}`}
              label={account.display_name || account.username || account.account_id}
              onCheckedChange={(checked) => onToggleAccount(account.account_id, checked)}
            />
            <span className="ss-character-account-count">{formatCharacterVideoCount(account.appearance_count, account.draft_count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatCharacterVideoCount(appearanceCount: number | null, draftCount: number | null): string {
  const safeAppearanceCount = typeof appearanceCount === "number" ? appearanceCount : 0;
  const safeDraftCount = typeof draftCount === "number" ? draftCount : 0;
  const total = safeAppearanceCount + safeDraftCount;

  if (total > 0) {
    return `${formatCount(total)} videos`;
  }
  return "No videos";
}
