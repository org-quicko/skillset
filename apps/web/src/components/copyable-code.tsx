import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconSwap } from "@/components/icon-swap";
import { cn } from "@/lib/utils";

/**
 * A read-only, monospace code block with a copy-to-clipboard button — for a
 * config snippet meant to be pasted into a file verbatim rather than read
 * line by line.
 *
 * @param code - The exact text both rendered and copied.
 * @param wrap - Wrap long lines instead of scrolling sideways — for a command,
 * whose meaning does not depend on where it breaks. Leave off for a file, whose
 * indentation should stay as written.
 */
export function CopyableCode({ code, wrap = false }: { code: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard access can be denied (insecure context, permissions) — the
      // text is on screen to copy by hand, so there is nothing to recover.
    }
    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3">
      <pre
        className={cn(
          "min-w-0 flex-1 font-mono text-[13px]",
          wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "overflow-x-auto",
        )}
      >
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label="Copy to clipboard"
        onClick={copy}
        className="relative flex shrink-0 cursor-pointer rounded-md p-2 -m-2 text-muted-foreground transition-[color,scale] duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
      >
        <IconSwap
          showAlt={copied}
          base={<CopyIcon className="size-4" />}
          alt={<CheckIcon className="size-4" />}
        />
      </button>
    </div>
  );
}
