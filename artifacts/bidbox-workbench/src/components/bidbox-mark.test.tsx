import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BidBoxMark, BidBoxSymbol } from "./bidbox-mark";

const workbench = resolve(import.meta.dirname, "../..");

function paths(element: ParentNode) {
  return Array.from(element.querySelectorAll("path"), (path) => ({
    d: path.getAttribute("d")?.replace(/\s+/gu, " ").trim(),
    fill: path.getAttribute("fill")?.toLowerCase(),
    fillRule: (path.getAttribute("fill-rule") ?? "nonzero").toLowerCase(),
  }));
}

describe("BidBox identity", () => {
  it("supports the default, custom and icon-only wordmarks", () => {
    const { container, rerender } = render(<BidBoxMark />);
    expect(screen.getByText("BidBox")).toBeVisible();

    rerender(<BidBoxMark label="BidBox Workbench" />);
    expect(screen.getByText("BidBox Workbench")).toBeVisible();
    expect(screen.queryByText("BidBox")).not.toBeInTheDocument();

    rerender(<BidBoxMark label={null} />);
    expect(container.textContent).toBe("");
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("keeps the symbol decorative and lets callers override its size", () => {
    const { container } = render(
      <BidBoxSymbol className="size-12 text-primary" />,
    );
    const symbol = container.querySelector("svg");
    expect(symbol).toHaveAttribute("aria-hidden", "true");
    expect(symbol).toHaveAttribute("focusable", "false");
    expect(symbol).not.toHaveAttribute("tabindex");
    expect(symbol).toHaveAttribute("viewBox", "0 0 32 32");
    expect(symbol).toHaveClass("size-12", "shrink-0", "text-primary");
    expect(symbol).not.toHaveClass("size-8");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("merges wordmark layout classes without changing the default symbol size", () => {
    const { container } = render(<BidBoxMark className="gap-4 text-primary" />);
    expect(container.firstElementChild).toHaveClass(
      "inline-flex",
      "items-center",
      "gap-4",
      "text-primary",
    );
    expect(container.firstElementChild).not.toHaveClass("gap-2.5");
    expect(container.querySelector("svg")).toHaveClass("size-8", "shrink-0");
  });

  it("uses the same two-path symbol in the application, favicon and social card", () => {
    const { container } = render(<BidBoxSymbol />);
    const symbolPaths = paths(container);
    expect(symbolPaths).toHaveLength(2);

    for (const asset of ["favicon.svg", "opengraph.svg"]) {
      const markup = readFileSync(resolve(workbench, "public", asset), "utf8");
      const document = new DOMParser().parseFromString(markup, "image/svg+xml");
      expect(document.querySelector("parsererror"), asset).toBeNull();
      expect(paths(document), asset).toEqual(symbolPaths);
    }

    const mockup = readFileSync(
      resolve(
        workbench,
        "../mockup-sandbox/src/components/mockups/SignInLanding.tsx",
      ),
      "utf8",
    );
    for (const path of symbolPaths) {
      expect(path.d).toBeTruthy();
      expect(mockup).toContain(path.d);
    }
  });
});
