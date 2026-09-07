import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "./not-found";

describe("NotFound", () => {
  it("gives people a clear way forward without developer jargon", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: "We couldn't find this page" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/check the address or use the navigation/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/router/i)).not.toBeInTheDocument();
  });
});
