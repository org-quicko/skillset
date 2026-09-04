import type { TokenCreated } from "@skill-registry/shared";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { IconSwap } from "@/components/icon-swap";
import { LabeledField } from "@/components/labeled-field";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useMintToken, useRevokeToken, useTokens } from "@/hooks/use-tokens";
import { apiErrorMessage } from "@/lib/api";
import { formatMoment } from "@/lib/utils";

/** Placeholder rows for the token list while `useTokens` is in flight. */
function TokenRowsSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-3 border-b px-5 py-3.5 last:border-b-0">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-52" />
          </div>
          <Skeleton className="h-7 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function MintedSecret({ token, onDismiss }: { token: TokenCreated; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — the secret is on screen to copy by hand.
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{token.name}</span>
        <button
          type="button"
          aria-label="Copy secret"
          onClick={copy}
          className="-m-2 flex cursor-pointer rounded-md p-2 text-muted-foreground transition-[color,scale] duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]"
        >
          <IconSwap
            showAlt={copied}
            base={<CopyIcon className="size-4" />}
            alt={<CheckIcon className="size-4" />}
          />
        </button>
      </div>
      <code className="rounded bg-muted p-2 font-mono text-xs break-all">{token.secret}</code>
      <p className="text-xs text-muted-foreground">
        Copy this now — it is shown once and cannot be retrieved again.
      </p>
      <Button variant="outline" size="sm" className="w-fit" onClick={onDismiss}>
        Done
      </Button>
    </div>
  );
}

export function TokensCard() {
  const [name, setName] = useState("");
  // The one and only copy of a minted secret: component state, dropped when
  // this card unmounts and never written to the query cache.
  const [minted, setMinted] = useState<TokenCreated | null>(null);

  const tokens = useTokens();
  const mint = useMintToken(setMinted);
  const revoke = useRevokeToken();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    mint.mutate({ name }, { onSuccess: () => setName("") });
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Panel title="New Token" description="A Token lets the CLI act as you, with your role.">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <LabeledField label="Name" htmlFor="token_name">
            <Input
              id="token_name"
              placeholder="my-laptop"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="h-10"
            />
          </LabeledField>
          {mint.isError && <p className="text-sm text-destructive">{apiErrorMessage(mint.error)}</p>}
          <Button type="submit" className="w-fit" disabled={mint.isPending}>
            {mint.isPending ? "Minting…" : "Mint Token"}
          </Button>
          {minted && <MintedSecret token={minted} onDismiss={() => setMinted(null)} />}
        </form>
      </Panel>

      <Panel title="Your Tokens" contentClassName="p-0">
        {tokens.isPending && <TokenRowsSkeleton />}
        {tokens.isError && <p className="p-5 text-sm text-destructive">{apiErrorMessage(tokens.error)}</p>}
        {tokens.isSuccess && tokens.data.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">No Tokens yet.</p>
        )}
        {tokens.data?.map((token) => (
          <div
            key={token.id}
            className="flex items-center justify-between gap-3 border-b px-5 py-3.5 last:border-b-0"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{token.name}</span>
              <span className="text-xs text-muted-foreground">
                Created {formatMoment(token.created_at)} · last used {formatMoment(token.last_used_at)}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(token.id)}
            >
              Revoke
            </Button>
          </div>
        ))}
        {revoke.isError && <p className="px-5 py-3 text-sm text-destructive">{apiErrorMessage(revoke.error)}</p>}
      </Panel>
    </div>
  );
}
