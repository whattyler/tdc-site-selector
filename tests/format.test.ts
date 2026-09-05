import { describe, expect, it } from "vitest";

import { groupNumber, parseNumber, stripGrouping } from "@/lib/format";

describe("groupNumber", () => {
  it("groups thousands", () => {
    expect(groupNumber("10424289")).toBe("10,424,289");
    expect(groupNumber("999")).toBe("999");
    expect(groupNumber("1000")).toBe("1,000");
  });

  it("keeps exactly the decimals that were typed", () => {
    expect(groupNumber("10424289.5")).toBe("10,424,289.5");
    expect(groupNumber("0.0725")).toBe("0.0725");
    expect(groupNumber("1.00")).toBe("1.00");
  });

  it("passes blank and unparseable text through untouched", () => {
    expect(groupNumber("")).toBe("");
    expect(groupNumber("   ")).toBe("");
    // A typo stays visible rather than silently disappearing.
    expect(groupNumber("12abc")).toBe("12abc");
  });

  it("handles negatives", () => {
    expect(groupNumber("-1250000")).toBe("-1,250,000");
  });

  it("round-trips through the parser the engine uses", () => {
    const grouped = groupNumber("10424289.25");
    expect(parseNumber(grouped)).toBe(10424289.25);
  });
});

describe("stripGrouping", () => {
  it("removes separators so state stays raw", () => {
    expect(stripGrouping("10,424,289")).toBe("10424289");
    expect(stripGrouping("10424289")).toBe("10424289");
    expect(stripGrouping("")).toBe("");
  });
});
