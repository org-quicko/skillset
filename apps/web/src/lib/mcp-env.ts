import type { McpEnvironmentVariable } from "@in-org-quicko/skillset-shared";

/** One environment variable as the List MCP server form edits it. */
export interface McpEnvRow {
  name: string;
  required: boolean;
}

/**
 * Turns the form's environment variable rows into the variables a package declares.
 *
 * @param rows - The rows as entered. A row with a blank name is dropped, and a
 * name repeated later is dropped in favour of its first row.
 * @param existing - The variables the server already has. A name found here
 * keeps its description and default, which the form has no field for.
 * @returns The variables in row order, or undefined when there are none.
 *
 * @example
 * ```ts
 * toEnvironmentVariables([{ name: " API_KEY ", required: false }], []);
 * // -> [{ name: "API_KEY", required: false }]
 * ```
 */
export function toEnvironmentVariables(
  rows: readonly McpEnvRow[],
  existing: readonly McpEnvironmentVariable[],
): McpEnvironmentVariable[] | undefined {
  const variables: McpEnvironmentVariable[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || variables.some((variable) => variable.name === name)) continue;
    const kept = existing.find((variable) => variable.name === name);
    variables.push({ ...kept, name, required: row.required });
  }
  return variables.length > 0 ? variables : undefined;
}
