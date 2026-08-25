import { roleMeets, type Role } from "@skill-registry/shared";
import { useState } from "react";
import { PublishSkillForm } from "@/components/publish-skill-form";
import { SkillDetail } from "@/components/skill-detail";
import { SkillList } from "@/components/skill-list";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/lib/use-router";

const SKILL_PATH_PREFIX = "/skills/";

function skillPath(name: string): string {
  return `${SKILL_PATH_PREFIX}${encodeURIComponent(name)}`;
}

export function SkillsPanel({ role }: { role: Role }) {
  const { pathname, navigate } = useRouter();
  // Lifted above SkillList so switching to detail and back doesn't reset the
  // reader to page 1 of the list, or clear whatever they were searching for.
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);

  // A new search term starts back on page 1 — the old page number rarely
  // makes sense against a different, usually much shorter, result set.
  function handleQueryChange(next: string) {
    setQuery(next);
    setPage(1);
  }

  if (pathname.startsWith(SKILL_PATH_PREFIX)) {
    const name = decodeURIComponent(pathname.slice(SKILL_PATH_PREFIX.length));
    return (
      <SkillDetail
        name={name}
        canDelete={roleMeets(role, "admin")}
        onBack={() => navigate("/")}
        onDeleted={() => navigate("/")}
      />
    );
  }

  return (
    <>
      <SkillList
        canPublish={roleMeets(role, "writer")}
        page={page}
        onPageChange={setPage}
        query={query}
        onQueryChange={handleQueryChange}
        onSelect={(name) => navigate(skillPath(name))}
        onPublish={() => setPublishOpen(true)}
      />
      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Publish a Skill</DialogTitle>
            <DialogDescription>Drop the Skill&apos;s folder here, or choose it from a dialog.</DialogDescription>
          </DialogHeader>
          <PublishSkillForm
            onPublished={(name) => {
              setPublishOpen(false);
              navigate(skillPath(name));
            }}
            onCancel={() => setPublishOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
