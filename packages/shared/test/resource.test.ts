import { describe, expect, it } from "bun:test";
import {
  isKind,
  KIND_KEYS,
  KINDS,
  kindConfig,
  ResourcePayloadSchema,
  SKILL_DESCRIPTION_MAX_LENGTH,
} from "../src/index.js";

/**
 * `KINDS` is the one place a Kind's own rules are registered (ADR-0026).
 * `skill` is the only Kind this ticket registers; a fourth Kind is an insert
 * here, not a migration — these tests pin what that insert must provide.
 */
describe("KINDS", () => {
  it("registers skill with its own name rule, description limit, and Artifact-ness", () => {
    const skill = KINDS.skill;
    expect(skill).toBeDefined();
    expect(skill?.hasArtifact).toBe(true);
    expect(skill?.descriptionMaxLength).toBe(SKILL_DESCRIPTION_MAX_LENGTH);
    expect(skill?.validateName("code-review")).toBe("code-review");
    expect(() => skill?.validateName("Not Valid")).toThrow();
  });

  it("lists exactly the registered Kind keys", () => {
    expect(KIND_KEYS).toEqual(["skill"]);
  });
});

describe("isKind / kindConfig", () => {
  it("recognises a registered Kind and refuses one that isn't", () => {
    expect(isKind("skill")).toBe(true);
    expect(isKind("mcp-server")).toBe(false);
    expect(isKind("")).toBe(false);
  });

  it("returns the config for a known Kind", () => {
    const config = KINDS.skill;
    if (!config) throw new Error("skill Kind not registered");
    expect(kindConfig("skill")).toBe(config);
  });

  it("throws, naming the known Kinds, for an unregistered one", () => {
    expect(() => kindConfig("plugin")).toThrow(/Unknown Kind "plugin"/);
  });
});

/**
 * The discriminated union every Resource's `payload` is validated against
 * (ADR-0026). `skill` is the only variant so far; a payload that doesn't
 * narrow to a registered Kind is refused rather than silently accepted.
 */
describe("ResourcePayloadSchema", () => {
  it("accepts a Skill payload with every field set", () => {
    const result = ResourcePayloadSchema.safeParse({
      kind: "skill",
      license: "MIT",
      compatibility: "Claude Code",
      metadata: { team: "platform" },
      allowed_tools: "Read, Grep",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a Skill payload with every optional field null", () => {
    const result = ResourcePayloadSchema.safeParse({
      kind: "skill",
      license: null,
      compatibility: null,
      metadata: null,
      allowed_tools: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload naming a kind no variant is registered for", () => {
    const result = ResourcePayloadSchema.safeParse({
      kind: "mcp-server",
      license: null,
      compatibility: null,
      metadata: null,
      allowed_tools: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing the kind discriminator entirely", () => {
    const result = ResourcePayloadSchema.safeParse({
      license: null,
      compatibility: null,
      metadata: null,
      allowed_tools: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a skill payload missing one of its required (nullable) keys", () => {
    const result = ResourcePayloadSchema.safeParse({
      kind: "skill",
      license: null,
      compatibility: null,
      metadata: null,
      // allowed_tools omitted entirely, not even null.
    });
    expect(result.success).toBe(false);
  });
});
