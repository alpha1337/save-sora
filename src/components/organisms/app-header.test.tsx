import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "./app-header";

function renderHeader(sessionMessage: string) {
  render(
    <AppHeader
      appVersion="2.0.351"
      disabledSettings={false}
      onOpenSettings={vi.fn()}
      selectedBytes={0}
      selectedCount={0}
      sessionMessage={sessionMessage}
      totalCount={0}
      viewerPlanTypeBadge="PLUS"
      viewerProfilePictureUrl=""
      viewerUsername="whatreallyhappened"
    />
  );
}

describe("AppHeader", () => {
  it("renders first-run onboarding thanks copy", () => {
    renderHeader('Thank you for trying "Save Sora", whatreallyhappened');

    expect(screen.getByText('Thank you for trying "Save Sora", whatreallyhappened')).toBeInTheDocument();
    expect(screen.queryByText(/Logged in as/i)).not.toBeInTheDocument();
  });

  it("renders returning user welcome copy", () => {
    renderHeader("Welcome back, whatreallyhappened");

    expect(screen.getByText("Welcome back, whatreallyhappened")).toBeInTheDocument();
  });
});
