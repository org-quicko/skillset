import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillFile } from "@in-org-quicko/skillset-shared";
import {
  hashInstalledSkill,
  hashSkillFiles,
  LOCKFILE_NAME,
  LOCKFILE_VERSION,
  readLockfile,
  resolveLockfilePath,
  skillStatus,
  writeLockfile,
  type LockfileEntry,
} from "./lockfile.js";

const REGISTRY = "https://registry.example";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function entry(overrides: Partial<LockfileEntry> = {}): LockfileEntry {
  return {
    id: "01a0c2b9-5ae9-782d-8ae6-d27d8d18a968",
    registry_updated_at: "2026-09-21T06:48:42.469Z",
    content_hash: "sha256:abc",
    installed_at: "2026-09-21T07:00:00.000Z",
    agent: "claude-code",
    ...overrides,
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "skillset-lockfile-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("resolveLockfilePath", () => {
  // Beside the thing it describes, not inside `.agents/` — an Agent scanning
  // its skills directory must never find a lockfile in there.
  it("puts a project lockfile at the project root", () => {
    expect(resolveLockfilePath("project", { cwd: "/repo", homeDir: "/home/dev" })).toBe(join("/repo", LOCKFILE_NAME));
  });

  it("puts a user lockfile at the home directory", () => {
    expect(resolveLockfilePath("user", { cwd: "/repo", homeDir: "/home/dev" })).toBe(
      join("/home/dev", LOCKFILE_NAME),
    );
  });
});

describe("readLockfile", () => {
  it("answers an empty lockfile when there is no file yet", async () => {
    const lock = await readLockfile(join(dir, LOCKFILE_NAME), REGISTRY);
    expect(lock).toEqual({ version: LOCKFILE_VERSION, registry: REGISTRY, skills: {} });
  });

  it("round-trips what was written", async () => {
    const path = join(dir, LOCKFILE_NAME);
    await writeLockfile(path, { version: LOCKFILE_VERSION, registry: REGISTRY, skills: { "code-review": entry() } });

    const lock = await readLockfile(path, "https://other.example");
    expect(lock.registry).toBe(REGISTRY);
    expect(lock.skills["code-review"]).toEqual(entry());
  });

  // A corrupt or hand-edited lockfile must not make `install` refuse:
  // the worst outcome of rebuilding is one Skill reported as missing, which
  // the next install corrects.
  it.each([
    ["is not JSON", "{{{"],
    ["is not an object", '"a string"'],
    ["has no skills map", '{"version":1,"registry":"https://registry.example"}'],
    ["comes from a newer format", '{"version":999,"registry":"https://registry.example","skills":{"a":{}}}'],
  ])("falls back to empty when the file %s", async (_case, contents) => {
    const path = join(dir, LOCKFILE_NAME);
    await writeFile(path, contents, "utf8");

    expect(await readLockfile(path, REGISTRY)).toEqual({ version: LOCKFILE_VERSION, registry: REGISTRY, skills: {} });
  });
});

describe("writeLockfile", () => {
  it("sorts entries so the file diffs as a change rather than a reordering", async () => {
    const path = join(dir, LOCKFILE_NAME);
    await writeLockfile(path, {
      version: LOCKFILE_VERSION,
      registry: REGISTRY,
      skills: { zebra: entry(), alpha: entry(), middle: entry() },
    });

    const written = JSON.parse(await readFile(path, "utf8")) as { skills: Record<string, unknown> };
    expect(Object.keys(written.skills)).toEqual(["alpha", "middle", "zebra"]);
  });

  // Removing the last Skill should leave a project root exactly as it was
  // found, not holding an empty record.
  it("removes the file instead of writing an empty one", async () => {
    const path = join(dir, LOCKFILE_NAME);
    await writeLockfile(path, { version: LOCKFILE_VERSION, registry: REGISTRY, skills: { a: entry() } });
    await writeLockfile(path, { version: LOCKFILE_VERSION, registry: REGISTRY, skills: {} });

    expect(await Bun.file(path).exists()).toBe(false);
  });

  it("does not fail when there was no file to remove", async () => {
    const path = join(dir, LOCKFILE_NAME);
    await writeLockfile(path, { version: LOCKFILE_VERSION, registry: REGISTRY, skills: {} });
    expect(await Bun.file(path).exists()).toBe(false);
  });
});

describe("hashSkillFiles", () => {
  const files: SkillFile[] = [
    { path: "SKILL.md", bytes: bytes("# Title\n") },
    { path: "references/java.md", bytes: bytes("notes\n") },
  ];

  it("is stable across the order files arrive in", () => {
    expect(hashSkillFiles(files)).toBe(hashSkillFiles([...files].reverse()));
  });

  it("changes when a file's contents change", () => {
    const edited: SkillFile[] = [{ path: "SKILL.md", bytes: bytes("# Edited\n") }, files[1]!];
    expect(hashSkillFiles(edited)).not.toBe(hashSkillFiles(files));
  });

  it("changes when a file is added", () => {
    expect(hashSkillFiles([...files, { path: "extra.md", bytes: bytes("x") }])).not.toBe(hashSkillFiles(files));
  });

  it("changes when a file is renamed but its bytes are not", () => {
    const renamed: SkillFile[] = [files[0]!, { path: "references/kotlin.md", bytes: bytes("notes\n") }];
    expect(hashSkillFiles(renamed)).not.toBe(hashSkillFiles(files));
  });

  // Each file's length is mixed in before its bytes, so no concatenation of
  // one file's path into another's content can produce a matching digest.
  it("separates path from content", () => {
    const a: SkillFile[] = [{ path: "ab", bytes: bytes("c") }];
    const b: SkillFile[] = [{ path: "a", bytes: bytes("bc") }];
    expect(hashSkillFiles(a)).not.toBe(hashSkillFiles(b));
  });
});

describe("hashInstalledSkill", () => {
  it("matches what hashSkillFiles produced for the same files", async () => {
    const files: SkillFile[] = [
      { path: "SKILL.md", bytes: bytes("# Title\n") },
      { path: "references/java.md", bytes: bytes("notes\n") },
    ];
    const skillDir = join(dir, "code-review");
    await mkdir(join(skillDir, "references"), { recursive: true });
    for (const file of files) await writeFile(join(skillDir, ...file.path.split("/")), file.bytes);

    expect(await hashInstalledSkill(skillDir)).toBe(hashSkillFiles(files));
  });

  it("notices an edit made after the install", async () => {
    const skillDir = join(dir, "code-review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Title\n");
    const before = await hashInstalledSkill(skillDir);

    await writeFile(join(skillDir, "SKILL.md"), "# Title\n\nLocal note.\n");
    expect(await hashInstalledSkill(skillDir)).not.toBe(before);
  });

  it("answers null for a directory that is not there", async () => {
    expect(await hashInstalledSkill(join(dir, "never-installed"))).toBeNull();
  });
});

describe("skillStatus", () => {
  const installed = entry({ content_hash: "sha256:abc", registry_updated_at: "2026-09-21T06:48:42.469Z" });

  it("is current when the copy matches and the Registry has not moved", () => {
    expect(skillStatus(installed, "sha256:abc", "2026-09-21T06:48:42.469Z")).toBe("current");
  });

  it("is outdated when the Registry has moved on", () => {
    expect(skillStatus(installed, "sha256:abc", "2026-09-22T00:00:00.000Z")).toBe("outdated");
  });

  it("is modified when the copy no longer matches what was written", () => {
    expect(skillStatus(installed, "sha256:different", "2026-09-21T06:48:42.469Z")).toBe("modified");
  });

  it("is missing when the directory is gone", () => {
    expect(skillStatus(installed, null, "2026-09-21T06:48:42.469Z")).toBe("missing");
  });

  // The finding that costs a User work wins: a stale copy can be replaced
  // freely, a locally-edited one must not be replaced without being asked.
  it("reports modified ahead of outdated when a Skill is both", () => {
    expect(skillStatus(installed, "sha256:different", "2026-09-22T00:00:00.000Z")).toBe("modified");
  });

  it("cannot read outdated when the Registry was not consulted", () => {
    expect(skillStatus(installed, "sha256:abc", undefined)).toBe("current");
  });
});
