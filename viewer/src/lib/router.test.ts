import { describe, expect, it } from "vitest";
import { parseLocation } from "./router";

describe("parseLocation", () => {
  it("resolves the root path", () => {
    expect(parseLocation("/").route).toBe("/");
  });
  it("resolves /timeline", () => {
    expect(parseLocation("/timeline").route).toBe("/timeline");
  });
  it("falls back to / for any unknown path", () => {
    expect(parseLocation("/nope").route).toBe("/");
  });
  it("parses query params alongside the route", () => {
    const { route, params } = parseLocation("/timeline?event=42");
    expect(route).toBe("/timeline");
    expect(params.get("event")).toBe("42");
  });
  it("yields an empty params object when there's no query string", () => {
    expect([...parseLocation("/timeline").params.keys()]).toEqual([]);
  });
  it("handles multiple params, e.g. a file-search drill-down link", () => {
    const { params } = parseLocation("/timeline?q=file%3Asrc%2Fa.ts");
    expect(params.get("q")).toBe("file:src/a.ts");
  });
});
