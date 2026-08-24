import type { Role } from "@skill-registry/shared";
import { useState } from "react";
import { PublishSkillForm } from "@/components/publish-skill-form";
import { SkillDetail } from "@/components/skill-detail";
import { SkillList } from "@/components/skill-list";

type SkillsView = { type: "list" } | { type: "detail"; name: string } | { type: "publish" };

/** Publishing is refused to readers — hidden here, and rejected server-side either way. */
function canPublish(role: Role): boolean {
  return role !== "reader";
}

export function SkillsPanel({ role }: { role: Role }) {
  const [view, setView] = useState<SkillsView>({ type: "list" });

  if (view.type === "publish") {
    return (
      <PublishSkillForm
        onPublished={(name) => setView({ type: "detail", name })}
        onCancel={() => setView({ type: "list" })}
      />
    );
  }

  if (view.type === "detail") {
    return <SkillDetail name={view.name} onBack={() => setView({ type: "list" })} />;
  }

  return (
    <SkillList
      canPublish={canPublish(role)}
      onSelect={(name) => setView({ type: "detail", name })}
      onPublish={() => setView({ type: "publish" })}
    />
  );
}
