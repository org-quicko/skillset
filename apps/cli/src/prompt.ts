export interface PromptIO {
  isTTY: boolean;
  write(text: string): void;
  readLine(): Promise<string>;
}

/**
 * Asks the User to pick one entry from a numbered list, re-asking until the answer is in
 * range.
 *
 * @param question - The line printed above the list.
 * @param choices - The options, printed in order and numbered from 1. Must not be empty.
 * @param io - Where to write the prompt and read the answer from.
 * @returns The chosen entry of `choices`.
 *
 * @remarks
 * No prompts library — one selection needs nothing fancier, and `io` keeps the whole
 * thing testable without a terminal. Callers are responsible for checking `io.isTTY`
 * first: with no terminal attached, `readLine` returns end-of-input forever and this would
 * re-ask without end.
 *
 * @example
 * ```ts
 * const scope = await promptChoice("Install for which scope?", ["project", "user"], io);
 * ```
 */
export async function promptChoice(question: string, choices: readonly string[], io: PromptIO): Promise<string> {
  io.write(`${question}\n`);
  choices.forEach((choice, i) => io.write(`  ${i + 1}) ${choice}\n`));

  for (;;) {
    io.write("> ");
    const index = Number((await io.readLine()).trim());
    if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
      return choices[index - 1]!;
    }
    io.write(`Enter a number from 1 to ${choices.length}.\n`);
  }
}
