import { isNonBlankString, isWithinMaxLength } from "./resource-rules.js";

export const MCP_DESCRIPTION_MAX_LENGTH = 100;

export type McpRule =
  | "name_required"
  | "description_required"
  | "description_too_long"
  | "payload_invalid";

/**
 * Thrown when an MCP Server resource fails validation rules.
 */
export class McpValidationError extends Error {
  readonly rule: McpRule;
  readonly field: string | undefined;

  constructor(rule: McpRule, message: string, field?: string) {
    super(message);
    this.name = "McpValidationError";
    this.rule = rule;
    this.field = field;
  }
}

/**
 * Formats an {@link McpValidationError} into a one-line rule-naming message.
 */
export function formatMcpValidationError(error: McpValidationError): string {
  return `${error.rule}: ${error.message}${error.field ? ` (${error.field})` : ""}`;
}

/**
 * Checks that an MCP server has a name.
 *
 * @remarks
 * Any non-blank name is accepted. The upstream reverse-DNS convention
 * (`com.example/weather`) is a suggestion in the publish form, not a rule:
 * teams name their own servers however they like.
 *
 * @param value - The candidate name.
 * @returns The name, unchanged.
 * @throws McpValidationError `name_required` when the name is missing or blank.
 * @example
 * ```ts
 * validateMcpName("weather"); // -> "weather"
 * ```
 */
export function validateMcpName(value: unknown): string {
  if (!isNonBlankString(value)) {
    throw new McpValidationError("name_required", "An MCP server needs a name.", "name");
  }
  return value;
}

/**
 * Validates an MCP Server's description against the 100-character ceiling.
 */
export function validateMcpDescription(value: unknown): string {
  if (!isNonBlankString(value)) {
    throw new McpValidationError(
      "description_required",
      "An MCP server needs a non-empty description.",
      "description",
    );
  }
  if (!isWithinMaxLength(value, MCP_DESCRIPTION_MAX_LENGTH)) {
    throw new McpValidationError(
      "description_too_long",
      `An MCP server's description is at most ${MCP_DESCRIPTION_MAX_LENGTH} characters.`,
      "description",
    );
  }
  return value;
}
