import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconSwap } from "@/components/icon-swap";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils";

type Tab = "command" | "prompt";

/**
 * The Installation panel: a copyable `skillreg add` command, or a
 * natural-language prompt to hand an agent, switched by a tab in the header.
 *
 * @param name - The Skill's name, interpolated into both the command and the prompt.
 */
export function SkillInstallCard({ name }: { name: string }) {
  const [tab, setTab] = useState<Tab>("command");
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const command = `skillreg add ${name}`;
  const prompt = `Install the ${name} skill from the Skillset registry.`;
  const text = tab === "command" ? command : prompt;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be denied (insecure context, permissions) — the
      // text is on screen to copy by hand, so there is nothing to recover.
    }
    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Panel
      title="Installation"
      action={
        <div className="flex gap-3.5 text-xs">
          {(["command", "prompt"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "cursor-pointer rounded-sm capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                tab === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3">
        {tab === "command" && <span className="font-mono text-[13px] text-ring">$</span>}
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{text}</code>
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
    </Panel>
  );
}
