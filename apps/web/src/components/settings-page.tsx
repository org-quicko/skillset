import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TokensCard } from "@/components/tokens-card";

export function SettingsPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      </div>
      <TokensCard />
    </div>
  );
}
