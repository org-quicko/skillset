import type { TokenCreated } from "@skill-registry/shared";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMintToken, useRevokeToken, useTokens } from "@/hooks/use-tokens";
import { apiErrorMessage } from "@/lib/api";
import { formatMoment } from "@/lib/utils";

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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Tokens</CardTitle>
        <CardDescription>A Token lets the CLI act as you, with your role.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token_name">Name</Label>
            <Input
              id="token_name"
              placeholder="my-laptop"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          {mint.isError && <p className="text-sm text-destructive">{apiErrorMessage(mint.error)}</p>}
          <Button type="submit" disabled={mint.isPending}>
            {mint.isPending ? "Minting…" : "Mint Token"}
          </Button>
        </form>

        {minted && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm font-medium">{minted.name}</p>
            <code className="break-all rounded bg-muted p-2 text-xs">{minted.secret}</code>
            <p className="text-xs text-muted-foreground">
              Copy this now — it is shown once and cannot be retrieved again.
            </p>
            <Button variant="outline" size="sm" onClick={() => setMinted(null)}>
              Done
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {tokens.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {tokens.isError && <p className="text-sm text-destructive">{apiErrorMessage(tokens.error)}</p>}
          {tokens.isSuccess && tokens.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No Tokens yet.</p>
          )}
          {tokens.data?.map((token) => (
            <div key={token.id} className="flex items-center justify-between gap-3 border-b pb-2 last:border-b-0">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{token.name}</span>
                <span className="text-xs text-muted-foreground">
                  Created {formatMoment(token.created_at)} — last used {formatMoment(token.last_used_at)}
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
          {revoke.isError && <p className="text-sm text-destructive">{apiErrorMessage(revoke.error)}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
