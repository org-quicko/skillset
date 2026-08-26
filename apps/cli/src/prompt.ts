export interface PromptIO {
  isTTY: boolean;
  write(text: string): void;
  readLine(): Promise<string>;
}

function renderChoices(question: string, choices: readonly string[], io: PromptIO): void {
  io.write(`${question}\n`);
  choices.forEach((choice, i) => io.write(`  ${i + 1}) ${choice}\n`));
}

/** A numbered-list prompt, re-asking on an out-of-range answer. No prompts library — one selection needs nothing fancier. */
export async function promptChoice(question: string, choices: readonly string[], io: PromptIO): Promise<string> {
  renderChoices(question, choices, io);
  for (;;) {
    io.write("> ");
    const index = Number((await io.readLine()).trim());
    if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
      return choices[index - 1]!;
    }
    io.write(`Enter a number from 1 to ${choices.length}.\n`);
  }
}

/** Same numbered list, but accepts a comma- or space-separated set of choices ("1,3" / "1 3"); re-asks until at least one valid index is given. */
export async function promptMultiChoice(question: string, choices: readonly string[], io: PromptIO): Promise<string[]> {
  renderChoices(question, choices, io);
  for (;;) {
    io.write("> ");
    const raw = (await io.readLine()).trim();
    const parts = raw.split(/[\s,]+/).filter(Boolean);
    const indices = parts.map(Number);

    if (parts.length > 0 && indices.every((index) => Number.isInteger(index) && index >= 1 && index <= choices.length)) {
      return [...new Set(indices)].map((index) => choices[index - 1]!);
    }
    io.write(`Enter one or more numbers from 1 to ${choices.length}, separated by commas or spaces.\n`);
  }
}
