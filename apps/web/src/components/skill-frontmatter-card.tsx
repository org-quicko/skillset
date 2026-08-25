import type { Skill } from "@skill-registry/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** One optional frontmatter field, rendered only by the caller when it's present. */
function FrontmatterField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  );
}

/**
 * The Skill's name and description, plus whichever of the four optional
 * Agent Skills spec fields — `license`, `compatibility`, `metadata`,
 * `allowed_tools` — and tags it has. Each renders only when present; there
 * is no "not set" placeholder for one that isn't.
 */
export function SkillFrontmatterCard({ skill }: { skill: Skill }) {
  const metadataEntries = skill.metadata ? Object.entries(skill.metadata) : [];
  const hasExtras = skill.license || skill.compatibility || skill.allowed_tools || metadataEntries.length > 0 || skill.tags.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{skill.name}</CardTitle>
        <CardDescription>{skill.description}</CardDescription>
      </CardHeader>
      {hasExtras && (
        <CardContent className="flex flex-col gap-3 text-sm">
          {skill.license && <FrontmatterField label="License" value={skill.license} />}
          {skill.compatibility && <FrontmatterField label="Compatibility" value={skill.compatibility} />}
          {skill.allowed_tools && <FrontmatterField label="Allowed tools" value={skill.allowed_tools} />}
          {metadataEntries.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">Metadata</span>
              <dl className="flex flex-col gap-0.5 text-muted-foreground">
                {metadataEntries.map(([key, value]) => (
                  <div key={key} className="flex gap-1.5">
                    <dt className="font-medium text-foreground">{key}:</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {skill.tags.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
