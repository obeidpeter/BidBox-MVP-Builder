export interface UserManualParagraphBlock {
  type: "paragraph";
  text: string;
}

export interface UserManualSubheadingBlock {
  type: "subheading";
  id: string;
  title: string;
}

export interface UserManualListItem {
  text: string;
  children: UserManualListBlock[];
}

export interface UserManualListBlock {
  type: "list";
  ordered: boolean;
  start?: number;
  items: UserManualListItem[];
}

export interface UserManualTableBlock {
  type: "table";
  headers: string[];
  rows: string[][];
}

export interface UserManualRuleBlock {
  type: "rule";
}

export type UserManualBlock =
  | UserManualParagraphBlock
  | UserManualSubheadingBlock
  | UserManualListBlock
  | UserManualTableBlock
  | UserManualRuleBlock;

export interface UserManualSection {
  number: number;
  title: string;
  id: string;
  blocks: UserManualBlock[];
  searchText: string;
  routes: string[];
}

export interface ParsedUserManual {
  title: string;
  intro: UserManualBlock[];
  sections: UserManualSection[];
  searchText: string;
  routes: string[];
}

interface PendingSection {
  number: number;
  title: string;
  lines: string[];
}

interface ParsedListLine {
  indent: number;
  ordered: boolean;
  order?: number;
  text: string;
}

const numberedSectionPattern = /^##\s+(\d+)\.\s+(.+?)\s*$/;
const subheadingPattern = /^###\s+(.+?)\s*$/;
const listItemPattern = /^(\s*)(?:(\d+)\.|[-+*])\s+(.+?)\s*$/;
const exactAppRoutePattern =
  /^\/$|^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*\/?$/;

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\\([\\`*_[\]{}()#+.!|-])/g, "$1");
}

export function getManualPlainText(value: string): string {
  return stripInlineMarkdown(value).replace(/\s+/g, " ").trim();
}

export function normaliseManualSearchQuery(value: string): string {
  return getManualPlainText(value)
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{Letter}\p{Number}_:/?&.=+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyManualHeading(value: string): string {
  const slug = normaliseManualSearchQuery(value)
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

function isHorizontalRule(line: string): boolean {
  return /^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line);
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    const nextCharacter = trimmed[index + 1];

    if (character === "\\" && nextCharacter === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines: string[], index: number): boolean {
  return (
    lines[index]?.trim().startsWith("|") === true &&
    lines[index + 1]?.trim().startsWith("|") === true &&
    isTableSeparator(lines[index + 1] ?? "")
  );
}

function parseListLine(line: string): ParsedListLine | null {
  const match = line.match(listItemPattern);
  if (!match) {
    return null;
  }

  const indentation = match[1]?.replace(/\t/g, "    ").length ?? 0;
  const order = match[2] ? Number.parseInt(match[2], 10) : undefined;

  return {
    indent: indentation,
    ordered: order !== undefined,
    order,
    text: match[3] ?? "",
  };
}

function parseList(
  lines: string[],
  initialIndex: number,
  baseIndent: number,
): { block: UserManualListBlock; nextIndex: number } {
  const first = parseListLine(lines[initialIndex] ?? "");
  if (!first) {
    throw new Error("A manual list must start with a list item.");
  }

  const block: UserManualListBlock = {
    type: "list",
    ordered: first.ordered,
    ...(first.ordered && first.order !== undefined
      ? { start: first.order }
      : {}),
    items: [],
  };
  let index = initialIndex;

  while (index < lines.length) {
    const item = parseListLine(lines[index] ?? "");
    if (!item || item.indent < baseIndent) {
      break;
    }

    if (item.indent > baseIndent) {
      const parentItem = block.items.at(-1);
      if (!parentItem) {
        break;
      }

      const child = parseList(lines, index, item.indent);
      parentItem.children.push(child.block);
      index = child.nextIndex;
      continue;
    }

    if (item.ordered !== block.ordered) {
      break;
    }

    block.items.push({ text: item.text, children: [] });
    index += 1;
  }

  return { block, nextIndex: index };
}

function uniqueSlug(value: string, counts: Map<string, number>): string {
  const base = slugifyManualHeading(value);
  const count = (counts.get(base) ?? 0) + 1;
  counts.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

function startsStructuredBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    /^#{1,3}\s+/.test(line) ||
    isHorizontalRule(line) ||
    parseListLine(line) !== null ||
    isTableStart(lines, index)
  );
}

function parseBlocks(
  lines: string[],
  headingPrefix: string,
): UserManualBlock[] {
  const blocks: UserManualBlock[] = [];
  const headingCounts = new Map<string, number>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const subheading = line.match(subheadingPattern);
    if (subheading) {
      const title = subheading[1] ?? "";
      const localId = uniqueSlug(title, headingCounts);
      blocks.push({
        type: "subheading",
        id: `${headingPrefix}-${localId}`,
        title,
      });
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index]?.trim().startsWith("|")) {
        const row = splitTableRow(lines[index] ?? "");
        rows.push(
          headers.map((_, columnIndex) => row[columnIndex]?.trim() ?? ""),
        );
        index += 1;
      }

      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const listLine = parseListLine(line);
    if (listLine) {
      const parsed = parseList(lines, index, listLine.indent);
      blocks.push(parsed.block);
      index = parsed.nextIndex;
      continue;
    }

    const paragraphLines = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index]?.trim() !== "" &&
      !startsStructuredBlock(lines, index)
    ) {
      paragraphLines.push(lines[index]?.trim() ?? "");
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function blockText(block: UserManualBlock): string[] {
  switch (block.type) {
    case "paragraph":
      return [block.text];
    case "subheading":
      return [block.title];
    case "list":
      return block.items.flatMap((item) => [
        item.text,
        ...item.children.flatMap(blockText),
      ]);
    case "table":
      return [...block.headers, ...block.rows.flat()];
    case "rule":
      return [];
  }
}

function extractRoutes(values: string[]): string[] {
  const routes = new Set<string>();

  for (const value of values) {
    for (const match of value.matchAll(/`([^`\r\n]+)`/g)) {
      const candidate = match[1]?.trim() ?? "";
      if (exactAppRoutePattern.test(candidate)) {
        routes.add(candidate);
      }
    }
  }

  return [...routes];
}

function createSearchText(values: string[]): string {
  return normaliseManualSearchQuery(values.join(" "));
}

export function parseUserManualMarkdown(markdown: string): ParsedUserManual {
  const lines = markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const introLines: string[] = [];
  const pendingSections: PendingSection[] = [];
  let title = "User manual";
  let currentSection: PendingSection | null = null;

  for (const line of lines) {
    const titleMatch = line.match(/^#\s+(.+?)\s*$/);
    if (titleMatch && currentSection === null && pendingSections.length === 0) {
      title = titleMatch[1] ?? title;
      continue;
    }

    const sectionMatch = line.match(numberedSectionPattern);
    if (sectionMatch) {
      if (currentSection) {
        pendingSections.push(currentSection);
      }
      currentSection = {
        number: Number.parseInt(sectionMatch[1] ?? "0", 10),
        title: sectionMatch[2] ?? "",
        lines: [],
      };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      introLines.push(line);
    }
  }

  if (currentSection) {
    pendingSections.push(currentSection);
  }

  const sectionHeadingCounts = new Map<string, number>();
  const sections = pendingSections.map((section): UserManualSection => {
    const id = uniqueSlug(section.title, sectionHeadingCounts);
    const blocks = parseBlocks(section.lines, id);
    const values = [section.title, ...blocks.flatMap(blockText)];

    return {
      number: section.number,
      title: section.title,
      id,
      blocks,
      searchText: createSearchText(values),
      routes: extractRoutes(values),
    };
  });
  const intro = parseBlocks(introLines, "introduction");
  const introValues = intro.flatMap(blockText);
  const allValues = [
    title,
    ...introValues,
    ...sections.flatMap((section) => [
      section.title,
      ...section.blocks.flatMap(blockText),
    ]),
  ];

  return {
    title,
    intro,
    sections,
    searchText: createSearchText(allValues),
    routes: extractRoutes(allValues),
  };
}
