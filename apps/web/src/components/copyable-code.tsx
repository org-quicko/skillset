import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconSwap } from "@/components/icon-swap";

/**
 * A read-only, monospace code block with a copy-to-clipboard button — for a
 * config snippet meant to be pasted into a file verbatim rather than read
 * line by line.
 *
 * @param code - The exact text both rendered and copied.
 */
export function CopyableCode({ code }: { code: string }) {
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
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px]">
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
