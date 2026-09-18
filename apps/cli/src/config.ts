import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

/** Stored at rest and, field for field, what env vars can override. */
export const ConfigSchema = z.object({
  registry: z.string().min(1),
  token: z.string().min(1),
});
export type Config = z.infer<typeof ConfigSchema>;

export const NOT_LOGGED_IN_MESSAGE =
  "Not logged in. Run `skillset login` or set SKILLSET_REGISTRY and SKILLSET_TOKEN.";

/** Reads need no Token (ADR-0013), so they fail on the Registry's location alone. */
export const NO_REGISTRY_MESSAGE =
  "No Registry configured. Run `skillset login` or set SKILLSET_REGISTRY.";

/** Where to reach the Registry, and the Token to authenticate with when one is available. */
export interface RegistryAccess {
  registry: string;
  /** Absent when only a Registry location is configured — enough for reads, not for writes. */
  token?: string;
}

/**
 * Decides where the config file lives.
 *
 * @param env - The process environment; `SKILLSET_CONFIG_PATH` wins, then the conventional
 * per-OS location (`%APPDATA%\\skillset\\config.json` on Windows,
 * `$XDG_CONFIG_HOME/skillset/config.json` or `~/.config/skillset/config.json` elsewhere).
 * @returns An absolute path, which need not exist yet.
 *
 * @remarks
 * Reads only from `env` so it stays pure and testable without touching the real
 * filesystem or `os.homedir()`.
 *
 * @example
 * ```ts
 * resolveConfigPath({ XDG_CONFIG_HOME: "/home/dev/.config" });
 * // -> "/home/dev/.config/skillset/config.json"
 * ```
 */
export function resolveConfigPath(env: NodeJS.ProcessEnv): string {
  if (env.SKILLSET_CONFIG_PATH) return env.SKILLSET_CONFIG_PATH;
  if (env.APPDATA) return join(env.APPDATA, "skillset", "config.json");

  const configDir = env.XDG_CONFIG_HOME || join(env.HOME ?? env.USERPROFILE ?? "", ".config");
  return join(configDir, "skillset", "config.json");
}

/**
 * Loads the stored Registry location and Token.
 *
 * @param configPath - Where the config file lives, from {@link resolveConfigPath}.
 * @returns The stored config, or `null` when no config file has been written yet — a
 * missing file is the ordinary pre-login state, not a failure.
 * @throws Error when the file exists but holds invalid JSON, or JSON missing a registry or
 * token. Any other filesystem error (a permissions failure, say) is rethrown untouched.
 *
 * @example
 * ```ts
 * const stored = await readConfig(resolveConfigPath(process.env));
 * ```
 */
export async function readConfig(configPath: string): Promise<Config | null> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Config file at ${configPath} is not valid JSON.`);
  }

  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Config file at ${configPath} is missing a registry or token.`);
  }
  return parsed.data;
}

/**
 * Stores the Registry location and Token, creating the containing directory if needed.
 *
 * @param configPath - Where to write, from {@link resolveConfigPath}.
 * @param config - The Registry location and Token to persist.
 * @throws Error when the directory cannot be created or the file cannot be written.
 *
 * @remarks
 * The file holds a Token in plain text, so it is written `0600` and its directory `0700`.
 * `mode` on `writeFile` only applies when the file is created, so an existing one is
 * narrowed explicitly — a config written before this did not restrict it at all. Windows
 * has no POSIX mode and `chmod` is a near no-op there, which is why the failure is
 * ignored rather than aborting a login that otherwise succeeded.
 *
 * @example
 * ```ts
 * await writeConfig(resolveConfigPath(process.env), { registry: "https://registry.example", token });
 * ```
 */
export async function writeConfig(configPath: string, config: Config): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(configPath, 0o600);
  } catch {
    // Nothing to narrow on a filesystem without POSIX modes.
  }
}

/**
 * Combines the environment and the config file into the credentials a write needs.
 *
 * @param env - The process environment; `SKILLSET_REGISTRY` and `SKILLSET_TOKEN` each win
 * over the corresponding config-file field, so the same command works in CI with no login
 * step.
 * @param fileConfig - What {@link readConfig} returned, or `null` when nothing is stored.
 * @returns Both halves, or `null` when either is still missing.
 *
 * @example
 * ```ts
 * resolveCredentials({ SKILLSET_TOKEN: "t" }, { registry: "https://registry.example", token: "stored" });
 * // -> { registry: "https://registry.example", token: "t" }
 * ```
 */
export function resolveCredentials(env: NodeJS.ProcessEnv, fileConfig: Config | null): Config | null {
  const access = resolveRegistryAccess(env, fileConfig);
  if (!access?.token) return null;
  return { registry: access.registry, token: access.token };
}

/**
 * The same resolution as {@link resolveCredentials}, but for commands that only read.
 *
 * @param env - The process environment; the same two variables override the config file.
 * @param fileConfig - What {@link readConfig} returned, or `null` when nothing is stored.
 * @returns The Registry location plus a Token when one is configured, or `null` when not
 * even a location is known. Reads do not require authentication (ADR-0013), so a missing
 * Token is not a failure here — it just means the request goes out anonymously.
 *
 * @remarks
 * A stored Token belongs to the Registry it was stored against, so it is only offered
 * back when the resolved Registry is still that one. Overriding just `SKILLSET_REGISTRY`
 * used to keep the file's Token and send it to whatever host the variable named, handing
 * one Registry's credential to another. `SKILLSET_TOKEN` is unconditional — naming a
 * Token is stating which one to use.
 *
 * @example
 * ```ts
 * resolveRegistryAccess({ SKILLSET_REGISTRY: "https://registry.example" }, null);
 * // -> { registry: "https://registry.example", token: undefined }
 * ```
 */
export function resolveRegistryAccess(env: NodeJS.ProcessEnv, fileConfig: Config | null): RegistryAccess | null {
  const registry = env.SKILLSET_REGISTRY ?? fileConfig?.registry;
  if (!registry) return null;
  if (env.SKILLSET_TOKEN) return { registry, token: env.SKILLSET_TOKEN };

  const storedIsSameRegistry = fileConfig !== null && sameRegistry(registry, fileConfig.registry);
  return { registry, token: storedIsSameRegistry ? fileConfig.token : undefined };
}

/** Compares two Registry locations as locations, so a trailing slash or a capitalised host is not a different host. */
function sameRegistry(one: string, other: string): boolean {
  return normalizeRegistry(one) === normalizeRegistry(other);
}

function normalizeRegistry(registry: string): string {
  return registry.trim().replace(/\/+$/, "").toLowerCase();
}
