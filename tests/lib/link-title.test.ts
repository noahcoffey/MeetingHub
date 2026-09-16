import { describe, expect, it } from "vitest";
import { extractTitle, isUselessTitle } from "@/lib/link-title";

describe("extractTitle", () => {
  it("reads <title> and collapses whitespace", () => {
    expect(
      extractTitle("<html><head><title>\n  Quarterly\n  plan\n</title></head>"),
    ).toBe("Quarterly plan");
  });

  it("prefers og:title over <title>", () => {
    const html = `
      <title>Quarterly plan | Acme Corp</title>
      <meta property="og:title" content="Quarterly plan">`;
    expect(extractTitle(html)).toBe("Quarterly plan");
  });

  it("falls back to twitter:title, then <title>", () => {
    expect(
      extractTitle(`<meta name="twitter:title" content="Tweeted"><title>T</title>`),
    ).toBe("Tweeted");
    expect(extractTitle(`<meta property="og:title" content="  "><title>T</title>`)).toBe(
      "T",
    );
  });

  it("handles single quotes and reversed attribute order", () => {
    expect(extractTitle(`<meta content='Reversed' property='og:title'>`)).toBe(
      "Reversed",
    );
  });

  it("decodes named and numeric entities", () => {
    expect(extractTitle("<title>Tom &amp; Jerry &#8212; &#x2018;fun&#x2019;</title>")).toBe(
      "Tom & Jerry — ‘fun’",
    );
  });

  it("leaves unknown entities alone rather than mangling them", () => {
    expect(extractTitle("<title>A &weird; B</title>")).toBe("A &weird; B");
  });

  it("caps very long titles", () => {
    const title = extractTitle(`<title>${"x".repeat(400)}</title>`);
    expect(title).toHaveLength(200);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("returns null when there is no title", () => {
    expect(extractTitle("<html><body>hi</body></html>")).toBeNull();
    expect(extractTitle("<title>   </title>")).toBeNull();
  });
});

describe("isUselessTitle", () => {
  it("rejects a title that is just the URL or its host", () => {
    expect(isUselessTitle("https://ex.com/a", "https://ex.com/a")).toBe(true);
    expect(isUselessTitle("ex.com", "https://ex.com/a")).toBe(true);
    expect(isUselessTitle("ex.com", "https://www.ex.com/a")).toBe(true);
  });

  it("keeps a real title", () => {
    expect(isUselessTitle("Quarterly plan", "https://ex.com/a")).toBe(false);
  });
});
