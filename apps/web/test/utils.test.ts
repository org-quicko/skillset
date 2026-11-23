import { describe, expect, it } from "bun:test";
import { formatRelativeTime, userDisplayName, userInitials } from "../src/lib/utils";

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

describe("userInitials", () => {
  it("extracts initials from first and last names", () => {
    expect(userInitials({ first_name: "Ada", last_name: "Lovelace" })).toBe("AL");
    expect(userInitials({ first_name: "dev", last_name: "parikh" })).toBe("DP");
  });

  it("handles single-word first name with empty or missing last name without producing undefined (issue #70)", () => {
    expect(userInitials({ first_name: "Superadmin", last_name: "" })).toBe("SU");
    expect(userInitials({ first_name: "Superadmin" })).toBe("SU");
    expect(userInitials({ first_name: "S", last_name: "" })).toBe("S");
    expect(userInitials({ first_name: "S", last_name: undefined })).toBe("S");
  });

  it("extracts initials from multi-word first name when last name is missing", () => {
    expect(userInitials({ first_name: "Sarah Connor", last_name: "" })).toBe("SC");
    expect(userInitials({ first_name: "Dev Parikh" })).toBe("DP");
  });

  it("handles last name only", () => {
    expect(userInitials({ first_name: "", last_name: "Lovelace" })).toBe("LO");
    expect(userInitials({ first_name: null, last_name: "L" })).toBe("L");
  });

  it("falls back to email when first and last names are missing", () => {
    expect(userInitials({ email: "dev.parikh@quicko.com" })).toBe("DE");
    expect(userInitials({ first_name: "", last_name: "", email: "sqillset@quicko.com" })).toBe("SQ");
  });

  it("returns empty string if all fields are missing or empty", () => {
    expect(userInitials({})).toBe("");
    expect(userInitials({ first_name: "", last_name: "", email: "" })).toBe("");
  });
});

describe("userDisplayName", () => {
  it("combines first and last name", () => {
    expect(userDisplayName({ first_name: "Ada", last_name: "Lovelace" })).toBe("Ada Lovelace");
  });

  it("handles single name without trailing space", () => {
    expect(userDisplayName({ first_name: "Superadmin", last_name: "" })).toBe("Superadmin");
    expect(userDisplayName({ first_name: "", last_name: "Lovelace" })).toBe("Lovelace");
  });

  it("falls back to email when names are empty", () => {
    expect(userDisplayName({ email: "dev@example.com" })).toBe("dev@example.com");
  });

  it("returns empty string if all fields are empty", () => {
    expect(userDisplayName({})).toBe("");
  });
});

