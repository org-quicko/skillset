import { describe, expect, it } from "bun:test";
import { formatRelativeTime } from "../src/lib/utils";

const ago = (seconds: number): string => new Date(Date.now() - seconds * 1000).toISOString();
const DAY = 86_400;

describe("formatRelativeTime", () => {
  it("spells out weeks and months instead of abbreviating them", () => {
    expect(formatRelativeTime(ago(7 * DAY))).toBe("Last week");
    expect(formatRelativeTime(ago(14 * DAY))).toBe("2 weeks ago");
    expect(formatRelativeTime(ago(30 * DAY))).toBe("Last month");
    expect(formatRelativeTime(ago(365 * DAY))).toBe("Last year");
  });

  it("spells out the smaller units too", () => {
    expect(formatRelativeTime(ago(3 * DAY))).toBe("3 days ago");
    expect(formatRelativeTime(ago(2 * 3_600))).toBe("2 hours ago");
    expect(formatRelativeTime(ago(5 * 60))).toBe("5 minutes ago");
  });

  it("falls back to Just now under a minute and Never for null", () => {
    expect(formatRelativeTime(ago(10))).toBe("Just now");
    expect(formatRelativeTime(null)).toBe("Never");
  });
});
