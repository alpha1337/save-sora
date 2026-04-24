import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionBootstrapTakeover } from "./session-bootstrap-takeover";

describe("SessionBootstrapTakeover", () => {
  it("shows the background preload note while loading", () => {
    render(
      <SessionBootstrapTakeover
        errorMessage=""
        onRetry={vi.fn()}
        statusText="Loading user data..."
        visible
      />
    );

    expect(screen.getByText("Please wait a few minutes as your data is preloaded in the background.")).toBeInTheDocument();
  });
});
