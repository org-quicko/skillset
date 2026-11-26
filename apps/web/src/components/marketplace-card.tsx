import {
  CLAUDE_MARKETPLACE_PATH,
  MARKETPLACE_DESCRIPTION_MAX_LENGTH,
  type MarketplaceSettings,
} from "@in-org-quicko/skillset-shared";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CopyableCode } from "@/components/copyable-code";
import { InfoRow } from "@/components/info-row";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMarketplaceSettings, useUpdateMarketplaceSettings } from "@/hooks/use-marketplace";
import { apiErrorMessage } from "@/lib/api";

/** An Admin edits the name, owner, and description of the Registry's Claude Code marketplace. */
export function MarketplaceCard() {
  const settings = useMarketplaceSettings();
  const url = `${window.location.origin}${CLAUDE_MARKETPLACE_PATH}`;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Marketplace</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">
          The Claude Code marketplace this Registry serves. It lists every published plugin with a
          Claude Code manifest; these details are what Claude Code shows for it.
        </p>
      </div>

      <Panel contentClassName="p-0" className="bg-transparent">
        <InfoRow title="Marketplace URL" description="Add it with claude plugin marketplace add.">
          <div className="w-full max-w-md">
            <CopyableCode code={url} />
          </div>
        </InfoRow>
      </Panel>

      {settings.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {settings.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(settings.error)}</p>
      )}
      {settings.data && (
        <MarketplaceForm key={settings.data.updated_at ?? "default"} saved={settings.data} />
      )}
    </div>
  );
}

function MarketplaceForm({ saved }: { saved: MarketplaceSettings }) {
  const [name, setName] = useState(saved.name);
  const [ownerName, setOwnerName] = useState(saved.owner_name);
  const [ownerEmail, setOwnerEmail] = useState(saved.owner_email ?? "");
  const [description, setDescription] = useState(saved.description ?? "");
  const update = useUpdateMarketplaceSettings();

  const changed =
    name !== saved.name ||
    ownerName !== saved.owner_name ||
    ownerEmail !== (saved.owner_email ?? "") ||
    description !== (saved.description ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      {
        name: name.trim(),
        owner_name: ownerName.trim(),
        owner_email: ownerEmail.trim() || null,
        description: description.trim() || null,
      },
      { onSuccess: () => toast.success("Marketplace saved") },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      <Panel contentClassName="p-0" className="bg-transparent">
        <div className="divide-y">
          <InfoRow
            title="Name"
            description={
              name.trim() === saved.name
                ? "Lowercase letters, digits, and hyphens. Users install with <plugin>@" +
                  saved.name +
                  "."
                : "Renaming breaks installs that used the old name until users add the marketplace again."
            }
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="h-9 w-56"
            />
          </InfoRow>
          <InfoRow title="Owner">
            <Input
              placeholder="Eg. Acme"
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              required
              className="h-9 w-56"
            />
          </InfoRow>
          <InfoRow title="Owner email" description="Optional.">
            <Input
              type="email"
              placeholder="Eg. plugins@acme.com"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              className="h-9 w-56"
            />
          </InfoRow>
          <div className="flex flex-col gap-2 px-5 py-4">
            <span className="text-sm font-medium">Description</span>
            <Textarea
              placeholder="Optional. What these plugins are for."
              value={description}
              maxLength={MARKETPLACE_DESCRIPTION_MAX_LENGTH}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </div>
        </div>
      </Panel>
      {update.isError && (
        <p className="text-sm text-destructive">{apiErrorMessage(update.error)}</p>
      )}
      <div>
        <Button type="submit" disabled={!changed || update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
