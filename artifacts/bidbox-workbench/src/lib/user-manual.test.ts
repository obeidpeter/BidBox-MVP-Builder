import { describe, expect, it } from "vitest";

import userManualMarkdown from "../../../../docs/USER_MANUAL.md?raw";
import {
  normaliseManualSearchQuery,
  parseUserManualMarkdown,
  type UserManualListBlock,
  type UserManualTableBlock,
} from "@/lib/user-manual";

describe("parseUserManualMarkdown", () => {
  it("parses the canonical manual into searchable, anchored sections", () => {
    const manual = parseUserManualMarkdown(userManualMarkdown);

    expect(manual.title).toBe("BidBox Bid Autopsy Workbench — User Manual");
    expect(manual.intro).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "paragraph",
          text: expect.stringContaining("plain-language guide"),
        }),
      ]),
    );
    expect(manual.sections).toHaveLength(22);
    expect(manual.sections.map((section) => section.number)).toEqual(
      Array.from({ length: 22 }, (_, index) => index + 1),
    );
    expect(manual.sections[0]).toMatchObject({
      id: "what-bidbox-is",
      title: "What BidBox is",
    });
    expect(manual.sections[20]?.id).toBe("why-is-this-blocked-the-cheat-sheet");
    expect(manual.searchText).toContain(
      normaliseManualSearchQuery("forensic tender review"),
    );
    expect(manual.sections[7]?.searchText).toContain(
      normaliseManualSearchQuery("Submission rehearsal"),
    );
  });

  it("preserves tables and ordered, unordered and nested lists", () => {
    const manual = parseUserManualMarkdown(userManualMarkdown);
    const surfaces = manual.sections[1];
    const principles = manual.sections[0]?.blocks.find(
      (block): block is UserManualListBlock => block.type === "list",
    );
    const surfacesTable = surfaces?.blocks.find(
      (block): block is UserManualTableBlock => block.type === "table",
    );
    const pursuitTabs = manual.sections[7]?.blocks.find(
      (block): block is UserManualListBlock =>
        block.type === "list" && block.ordered && block.items.length === 10,
    );

    expect(principles).toMatchObject({ ordered: true, start: 1 });
    expect(principles?.items).toHaveLength(5);
    expect(surfacesTable?.headers).toEqual([
      "Surface",
      "Who sees it",
      "What it contains",
    ]);
    expect(surfacesTable?.rows).toHaveLength(3);
    expect(
      surfaces?.blocks.some(
        (block) =>
          block.type === "subheading" &&
          block.id === "the-three-surfaces-the-public-site",
      ),
    ).toBe(true);
    expect(pursuitTabs?.items).toHaveLength(10);
    expect(pursuitTabs?.items[4]?.children[0]).toMatchObject({
      type: "list",
      ordered: false,
    });
    expect(pursuitTabs?.items[4]?.children[0]?.items).toHaveLength(2);
    expect(pursuitTabs?.items[7]?.children[0]?.items).toHaveLength(4);
  });

  it("extracts only exact, static app routes from inline code", () => {
    const manual = parseUserManualMarkdown(userManualMarkdown);
    const signIn = manual.sections[2];
    const pursuits = manual.sections[7];

    expect(signIn?.routes).toEqual(["/sign-in", "/accept-invitation"]);
    expect(pursuits?.routes).toContain("/projects");
    expect(pursuits?.routes).not.toContain("/projects/:id");
    expect(manual.routes).not.toContain("?view=mobile");
    expect(manual.routes.every((route) => !route.includes(":"))).toBe(true);

    const synthetic = parseUserManualMarkdown(`# Manual

## 1. Routes

Use \`/safe-route\`, not \`/records/:id\`, \`/records/{id}\`, \`/with query\`,
\`https://example.com\`, or \`permission:read\`.
`);

    expect(synthetic.sections[0]?.routes).toEqual(["/safe-route"]);
  });

  it("suffixes duplicate heading anchors deterministically", () => {
    const manual = parseUserManualMarkdown(`# Manual

## 1. Repeated heading

### Details

First.

### Details

Second.

## 2. Repeated heading

Third.
`);

    expect(manual.sections.map((section) => section.id)).toEqual([
      "repeated-heading",
      "repeated-heading-2",
    ]);
    expect(
      manual.sections[0]?.blocks
        .filter((block) => block.type === "subheading")
        .map((block) => block.id),
    ).toEqual(["repeated-heading-details", "repeated-heading-details-2"]);
  });
});
