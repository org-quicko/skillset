import { roleMeets, type Role } from "@skill-registry/shared";
import { useState } from "react";
import { PublishSkillForm } from "@/components/publish-skill-form";
import { SkillDetail } from "@/components/skill-detail";
import { SkillList } from "@/components/skill-list";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SkillsView = { type: "list" } | { type: "detail"; name: string };

export function SkillsPanel({ role }: { role: Role }) {
  const [view, setView] = useState<SkillsView>({ type: "list" });
  // Lifted above SkillList so switching to detail and back doesn't reset the
  // reader to page 1 of the list.
  const [page, setPage] = useState(1);
  const [publishOpen, setPublishOpen] = useState(false);

  if (view.type === "detail") {
    return <SkillDetail name={view.name} onBack={() => setView({ type: "list" })} />;
  }

  return (
    <>
      <SkillList
        canPublish={roleMeets(role, "writer")}
        page={page}
        onPageChange={setPage}
        onSelect={(name) => setView({ type: "detail", name })}
        onPublish={() => setPublishOpen(true)}
      />
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Publish a Skill</DialogTitle>
            <DialogDescription>Drop the Skill's folder here, or choose it from a dialog.</DialogDescription>
          </DialogHeader>
          <PublishSkillForm
            onPublished={(name) => {
              setPublishOpen(false);
              setView({ type: "detail", name });
            }}
            onCancel={() => setPublishOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
