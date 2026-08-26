import { ArrowLeftIcon } from "lucide-react";
import { SkillActionsCard } from "@/components/skill-actions-card";
import { SkillAnalyticsCard } from "@/components/skill-analytics-card";
import { SkillBodyCard } from "@/components/skill-body-card";
import { SkillFrontmatterCard } from "@/components/skill-frontmatter-card";
import { Button } from "@/components/ui/button";
import { useSkill } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";

/**
 * A Skill's summary page: a compact back control above a two-column
 * layout of widgets — frontmatter and the rendered `SKILL.md` body on the
 * left, analytics and actions on the right. Fetches the Skill once and
 * passes it down; the widgets themselves fetch nothing.
 */
export function SkillDetail({
  name,
  canDelete,
  canEditTags,
  canRenameTags,
  onBack,
  onDeleted,
}: {
  name: string;
  canDelete: boolean;
  canEditTags: boolean;
  canRenameTags: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const skill = useSkill(name);

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeftIcon />
        Back to Skills
      </Button>

      {skill.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {skill.isError && <p className="text-sm text-destructive">{apiErrorMessage(skill.error)}</p>}

      {skill.isSuccess && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <SkillFrontmatterCard skill={skill.data} />
            <SkillBodyCard body={skill.data.body} />
          </div>
          <div className="flex flex-col gap-4">
            <SkillAnalyticsCard />
            <SkillActionsCard
              id={skill.data.id}
              name={skill.data.name}
              tags={skill.data.tags}
              canDelete={canDelete}
              canEditTags={canEditTags}
              canRenameTags={canRenameTags}
              onDeleted={onDeleted}
            />
          </div>
        </div>
      )}
    </div>
  );
}
