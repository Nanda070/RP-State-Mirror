import { describe, expect, it } from "vitest";
import { isSafeUrl, markdownText, parseInline, parseMarkdown } from "../src/lib/markdown.js";

describe("markdown subset", () => {
  it("parses blocks", () => {
    const blocks = parseMarkdown(
      [
        "# Заголовок",
        "",
        "Первая строка",
        "вторая строка",
        "",
        "- один",
        "- два",
        "",
        "1. раз",
        "2) два",
        "",
        "> цитата",
        "> дальше",
        "",
        "---",
        "",
        "```",
        "<b>код</b>",
        "```",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "quote", "rule", "code"]);
    expect(blocks[0]).toMatchObject({ level: 1 });
    expect(blocks[1]).toMatchObject({ children: [{ type: "text", value: "Первая строка вторая строка" }] });
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[6]).toMatchObject({ value: "<b>код</b>" });
  });

  it("starts a list right after a paragraph without a blank line", () => {
    expect(parseMarkdown("Шаги:\n- один\n- два").map((b) => b.type)).toEqual(["paragraph", "list"]);
  });

  it("parses inline marks", () => {
    expect(parseInline("**жирный** и *курсив* и `код`")).toEqual([
      { type: "bold", children: [{ type: "text", value: "жирный" }] },
      { type: "text", value: " и " },
      { type: "italic", children: [{ type: "text", value: "курсив" }] },
      { type: "text", value: " и " },
      { type: "code", value: "код" },
    ]);
  });

  it("keeps raw HTML as text and never produces unsafe links", () => {
    expect(parseInline("<script>alert(1)</script>")).toEqual([{ type: "text", value: "<script>alert(1)</script>" }]);
    expect(parseInline("[клик](javascript:alert(1))").some((n) => n.type === "link")).toBe(false);
    expect(parseInline("[клик](data:text/html,x)").some((n) => n.type === "link")).toBe(false);
    expect(parseInline("[клик](/relative)").some((n) => n.type === "link")).toBe(false);
    expect(isSafeUrl("https://example.com/a?b=1")).toBe(true);
    expect(isSafeUrl('https://example.com/"onmouseover="x')).toBe(false);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
  });

  it("links explicit and bare URLs without trailing punctuation", () => {
    expect(parseInline("[форум](https://forum.example/t/1)")).toEqual([
      { type: "link", href: "https://forum.example/t/1", children: [{ type: "text", value: "форум" }] },
    ]);
    expect(parseInline("см. https://example.com/x.")).toEqual([
      { type: "text", value: "см. " },
      { type: "link", href: "https://example.com/x", children: [{ type: "text", value: "https://example.com/x" }] },
      { type: "text", value: "." },
    ]);
  });

  it("extracts plain text for search", () => {
    expect(markdownText("# Как **получить** нашивку\n\n- команда `/нашивка`")).toBe(
      "Как получить нашивку команда /нашивка",
    );
  });
});
