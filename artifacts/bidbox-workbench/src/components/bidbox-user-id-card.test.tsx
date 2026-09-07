import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValoUserIdCard } from "./valo-user-id-card";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

const USER_ID = "2e1295d3-898f-4757-abec-a06df959401e";

describe("ValoUserIdCard", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    mocks.writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });

  it("shows the authenticated internal ID and copies that exact value", async () => {
    mocks.writeText.mockResolvedValue(undefined);
    render(<ValoUserIdCard userId={USER_ID} />);

    expect(screen.getByText(USER_ID).tagName).toBe("CODE");
    expect(
      screen.getByText(/not your email address or Clerk sign-in ID/i),
    ).toBeInTheDocument();
    expect(mocks.writeText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Copy Valo user ID" }));

    await waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith(USER_ID),
    );
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Valo user ID copied",
    });
  });

  it("keeps the ID visible and offers manual copying when clipboard access fails", async () => {
    mocks.writeText.mockRejectedValue(new Error("denied"));
    render(<ValoUserIdCard userId={USER_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy Valo user ID" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Could not copy Valo user ID",
        description: "Select and copy the identifier manually.",
      }),
    );
    expect(screen.getByText(USER_ID)).toBeInTheDocument();
  });
});
