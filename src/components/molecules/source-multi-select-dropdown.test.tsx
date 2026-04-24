import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SourceSelectionState } from "types/domain";
import { SourceMultiSelectDropdown } from "./source-multi-select-dropdown";

const emptySelections: SourceSelectionState = {
  profile: false,
  drafts: false,
  likes: false,
  characters: false,
  characterAccounts: false,
  creators: false
};

function renderDropdown(sourceSelections: SourceSelectionState) {
  render(
    <SourceMultiSelectDropdown
      onToggleSource={vi.fn()}
      sourceSelections={sourceSelections}
    />
  );
}

describe("SourceMultiSelectDropdown", () => {
  it("shows selected sources in option order with a remaining count", () => {
    renderDropdown({
      ...emptySelections,
      profile: true,
      drafts: true,
      likes: true,
      characters: true,
      characterAccounts: true
    });

    expect(screen.getByRole("button", { name: /Published, Drafts, Likes \+2 more/i })).toBeInTheDocument();
  });

  it("joins two selected sources with a plus", () => {
    renderDropdown({
      ...emptySelections,
      profile: true,
      drafts: true
    });

    expect(screen.getByRole("button", { name: /Published \+ Drafts/i })).toBeInTheDocument();
  });

  it("keeps the empty state label", () => {
    renderDropdown(emptySelections);

    expect(screen.getByRole("button", { name: /Select sources/i })).toBeInTheDocument();
  });
});
