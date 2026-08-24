import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSkill } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { renderSkillBody } from "@/lib/render-skill-body";

export function SkillDetail({ name, onBack }: { name: string; onBack: () => void }) {
  const skill = useSkill(name);
  const body = skill.data?.body;
  const html = useMemo(() => (body === undefined ? "" : renderSkillBody(body)), [body]);

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
          ← Back to Skills
        </Button>
        {skill.isSuccess && (
          <>
            <CardTitle>{skill.data.name}</CardTitle>
            <CardDescription>{skill.data.description}</CardDescription>
          </>
        )}
      </CardHeader>
      <CardContent>
        {skill.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
        {skill.isError && <p className="text-sm text-destructive">{apiErrorMessage(skill.error)}</p>}
        {skill.isSuccess && (
          <div
            className="text-sm leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </CardContent>
    </Card>
  );
}
