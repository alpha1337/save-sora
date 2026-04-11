import type { CharacterAccount } from "types/domain";
import { Button } from "@components/atoms/button";
import { Checkbox } from "@components/atoms/checkbox";

interface CharacterAccountSelectorProps {
  accounts: CharacterAccount[];
  disabled?: boolean;
  selectedAccountIds: string[];
  onLoadAccounts: () => void;
  onToggleAccount: (accountId: string, checked: boolean) => void;
}

/**
 * Character-account checklist with an explicit refresh action.
 */
export function CharacterAccountSelector({
  accounts,
  disabled = false,
  onLoadAccounts,
  onToggleAccount,
  selectedAccountIds
}: CharacterAccountSelectorProps) {
  return (
    <div className="ss-stack">
      <Button disabled={disabled} onClick={onLoadAccounts} tone="secondary" type="button">
        Load Character Accounts
      </Button>
      <div className="ss-scroll-list">
        {accounts.map((account) => (
          <Checkbox
            checked={selectedAccountIds.includes(account.account_id)}
            disabled={disabled}
            id={`character-account-${account.account_id}`}
            key={account.account_id}
            label={account.display_name || account.username || account.account_id}
            onCheckedChange={(checked) => onToggleAccount(account.account_id, checked)}
          />
        ))}
      </div>
    </div>
  );
}
