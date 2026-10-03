/**
 * Small Markdown subset for FAQ articles, parsed into a plain tree.
 * The tree is rendered as React elements (see components/markdown.tsx), so raw HTML in the source
 * is always shown as text and links are limited to http(s) — there is no HTML injection path.
 *
 * Supported: #/##/### headings, paragraphs, **bold**, *italic*, `code`, [text](url), bare URLs,
 * - and 1. lists, > quotes, ``` fenced code, --- rule.
 */

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "rule" };

const SAFE_URL = /^https?:\/\/[^\s<>"]+$/i;

export function isSafeUrl(url: string): boolean {
  return SAFE_URL.test(url);
}

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\n]+?\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)])/g;

export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE_RE)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > last) nodes.push({ type: "text", value: source.slice(last, index) });
    last = index + token.length;

    if (match[1]) {
      nodes.push({ type: "code", value: token.slice(1, -1) });
    } else if (match[2]) {
      nodes.push({ type: "bold", children: parseInline(token.slice(2, -2)) });
    } else if (match[3]) {
      nodes.push({ type: "italic", children: parseInline(token.slice(1, -1)) });
    } else if (match[4]) {
      const split = token.lastIndexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      // An unsafe target (javascript:, data:, relative) degrades to the visible label only.
      if (isSafeUrl(href)) nodes.push({ type: "link", href, children: [{ type: "text", value: label }] });
      else nodes.push({ type: "text", value: label });
    } else {
      nodes.push({ type: "link", href: token, children: [{ type: "text", value: token }] });
    }
  }
  if (last < source.length) nodes.push({ type: "text", value: source.slice(last) });
  return nodes;
}

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const BULLET_RE = /^\s*[-*]\s+(.+)$/;
const ORDERED_RE = /^\s*\d{1,3}[.)]\s+(.+)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const RULE_RE = /^(-{3,}|\*{3,})$/;
const FENCE_RE = /^```/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  const startsBlock = (line: string) =>
    HEADING_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line) ||
    QUOTE_RE.test(line) ||
    RULE_RE.test(line.trim()) ||
    FENCE_RE.test(line);

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (FENCE_RE.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE_RE.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // closing fence (or end of text)
      blocks.push({ type: "code", value: body.join("\n") });
      continue;
    }

    if (RULE_RE.test(line.trim())) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = (heading[1] ?? "#").length as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline((heading[2] ?? "").trim()) });
      index += 1;
      continue;
    }

    const listRe = BULLET_RE.test(line) ? BULLET_RE : ORDERED_RE.test(line) ? ORDERED_RE : null;
    if (listRe) {
      const items: Inline[][] = [];
      while (index < lines.length) {
        const item = listRe.exec(lines[index] ?? "");
        if (!item) break;
        items.push(parseInline((item[1] ?? "").trim()));
        index += 1;
      }
      blocks.push({ type: "list", ordered: listRe === ORDERED_RE, items });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (index < lines.length) {
        const quote = QUOTE_RE.exec(lines[index] ?? "");
        if (!quote) break;
        body.push(quote[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "quote", children: parseInline(body.join(" ").trim()) });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (current.trim() === "" || (paragraph.length > 0 && startsBlock(current))) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

/** Plain text of a document, for search. */
export function markdownText(source: string): string {
  const inline = (nodes: Inline[]): string =>
    nodes.map((node) => ("value" in node ? node.value : inline(node.children))).join("");
  return parseMarkdown(source)
    .map((block) => {
      if (block.type === "rule") return "";
      if (block.type === "code") return block.value;
      if (block.type === "list") return block.items.map(inline).join(" ");
      return inline(block.children);
    })
    .join(" ");
}
