import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

/** Stored at rest and, field for field, what env vars can override. */
export const ConfigSchema = z.object({
  registry: z.string().min(1),
  token: z.string().min(1),
});
export type Config = z.infer<typeof ConfigSchema>;

export const NOT_LOGGED_IN_MESSAGE =
  "Not logged in. Run `skillreg login` or set SKILLREG_REGISTRY and SKILLREG_TOKEN.";

/**
 * Where the config file lives: `SKILLREG_CONFIG_PATH` first, then the
 * conventional per-OS location (`%APPDATA%\skillreg\config.json` on Windows,
 * `$XDG_CONFIG_HOME/skillreg/config.json` or `~/.config/skillreg/config.json`
 * elsewhere). Reads only from `env` so it stays pure and testable without
 * touching the real filesystem or `os.homedir()`.
 */
export function resolveConfigPath(env: NodeJS.ProcessEnv): string {
  if (env.SKILLREG_CONFIG_PATH) return env.SKILLREG_CONFIG_PATH;
  if (env.APPDATA) return join(env.APPDATA, "skillreg", "config.json");

  const configDir = env.XDG_CONFIG_HOME || join(env.HOME ?? env.USERPROFILE ?? "", ".config");
  return join(configDir, "skillreg", "config.json");
}

/** `null` when no config file has been written yet. */
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

export async function writeConfig(configPath: string, config: Config): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * Env vars win over the config file, field by field (spec: "the same command
 * works in CI with no login step"). `null` when the combined result is still
 * missing either half.
 */
export function resolveCredentials(env: NodeJS.ProcessEnv, fileConfig: Config | null): Config | null {
  const registry = env.SKILLREG_REGISTRY ?? fileConfig?.registry;
  const token = env.SKILLREG_TOKEN ?? fileConfig?.token;
  if (!registry || !token) return null;
  return { registry, token };
}
