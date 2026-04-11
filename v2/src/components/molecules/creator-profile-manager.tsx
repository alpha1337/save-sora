import { Trash2, UserPlus } from "lucide-react";
import type { CreatorProfile } from "types/domain";
import { Button } from "@components/atoms/button";
import { Input } from "@components/atoms/input";
import { formatCount } from "@lib/utils/format-utils";

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
      <form
        className="ss-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && creatorRouteInput.trim()) {
            onAddCreatorProfile();
          }
        }}
      >
        <Input
          disabled={disabled}
          onChange={(event) => onCreatorRouteInputChange(event.target.value)}
          placeholder="@creator, crystal.party, or https://sora.chatgpt.com/profile/creator"
          value={creatorRouteInput}
        />
        <Button disabled={disabled || !creatorRouteInput.trim()} type="submit">
          <UserPlus size={16} />
          Add Creator
        </Button>
      </form>
      <ul className="ss-list">
        {creatorProfiles.map((profile) => (
          <li className="ss-list-row" key={profile.profile_id}>
            <div>
              <strong>{profile.display_name}</strong>
              <div className="ss-muted">@{profile.username || profile.user_id}</div>
              <div className="ss-muted">{formatSourceCounts(profile)}</div>
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

function formatSourceCounts(profile: CreatorProfile): string {
  const segments = profile.is_character_profile
    ? [
        typeof profile.appearance_count === "number" ? `${formatCount(profile.appearance_count)} appearances` : "",
        typeof profile.draft_count === "number" ? `${formatCount(profile.draft_count)} drafts` : ""
      ].filter(Boolean)
    : [
        typeof profile.published_count === "number" ? `${formatCount(profile.published_count)} published` : "",
        typeof profile.appearance_count === "number" ? `${formatCount(profile.appearance_count)} appearances` : "",
        typeof profile.draft_count === "number" ? `${formatCount(profile.draft_count)} drafts` : ""
      ].filter(Boolean);

  return segments.join(" · ") || "No source counts available";
}
