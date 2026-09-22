import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconSwap } from "@/components/icon-swap";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils";

type Tab = "command" | "prompt";

/** What this CLI is published as — the name `npx` has to be given to reach it. */
const CLI_PACKAGE = "@in-org-quicko/skillset-cli";

/**
 * The Installation panel: a copyable `npx` install command, or a
 * natural-language prompt to hand an agent, switched by a tab in the header.
 *
 * @param name - The Skill's name, interpolated into both the command and the prompt.
 * @param namespace - Which party named it, when a bare name would not reach
 * this Skill (ADR-0042) — see the remark below.
 *
 * @remarks
 * The command has to be one that installs *this* Skill, not one that happens
 * to share its name. A bare name resolves to the only Skill called that, or to
 * the one published here, so it is right for every first-party Skill and wrong
 * for an Imported one the moment the team publishes the same name. Qualifying
 * an Imported Skill's command is always correct and never misleading, so it is
 * qualified unconditionally rather than guessing whether a competitor exists.
 */
export function SkillInstallCard({ name, namespace }: { name: string; namespace?: string }) {
  const [tab, setTab] = useState<Tab>("command");
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const qualifier = namespace ? ` --namespace ${namespace}` : "";
  // The scoped package name, not the `skillset` bin name: npx resolves what it
  // is given as a package, and `skillset` on npm is somebody else's.
  const command = `npx ${CLI_PACKAGE} install ${name}${qualifier}`;
  const prompt = namespace
    ? `Install the ${name} skill from ${namespace} on the Skillset registry.`
    : `Install the ${name} skill from the Skillset registry.`;
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
