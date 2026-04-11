import { Trash2, UserPlus } from "lucide-react";
import type { CreatorProfile } from "types/domain";
import { Button } from "@components/atoms/button";
import { Input } from "@components/atoms/input";

interface CreatorProfileManagerProps {
  creatorProfiles: CreatorProfile[];
  creatorRouteInput: string;
  disabled?: boolean;
  onAddCreatorProfile: () => void;
  onCreatorRouteInputChange: (value: string) => void;
  onRemoveCreatorProfile: (profileId: string) => void;
}

/**
 * Saved creator editor used by the app container, without direct data access.
 */
export function CreatorProfileManager({
  creatorProfiles,
  creatorRouteInput,
  disabled = false,
  onAddCreatorProfile,
  onCreatorRouteInputChange,
  onRemoveCreatorProfile
}: CreatorProfileManagerProps) {
  return (
    <div className="ss-stack">
      <div className="ss-inline-form">
        <Input
          disabled={disabled}
          onChange={(event) => onCreatorRouteInputChange(event.target.value)}
          placeholder="https://sora.chatgpt.com/profile/username"
          value={creatorRouteInput}
        />
        <Button disabled={disabled || !creatorRouteInput.trim()} onClick={onAddCreatorProfile} type="button">
          <UserPlus size={16} />
          Add Creator
        </Button>
      </div>
      <ul className="ss-list">
        {creatorProfiles.map((profile) => (
          <li className="ss-list-row" key={profile.profile_id}>
            <div>
              <strong>{profile.display_name}</strong>
              <div className="ss-muted">@{profile.username || profile.user_id}</div>
            </div>
            <Button onClick={() => onRemoveCreatorProfile(profile.profile_id)} tone="ghost" type="button">
              <Trash2 size={16} />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
