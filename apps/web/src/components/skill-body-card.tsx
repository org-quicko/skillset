import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { renderSkillBody } from "@/lib/render-skill-body";

/** The Skill's rendered `SKILL.md` body — unchanged by splitting the page into widgets. */
export function SkillBodyCard({ body }: { body: string }) {
  const html = useMemo(() => renderSkillBody(body), [body]);

  return (
    <Card>
      <CardContent>
        <div
          className="text-sm leading-relaxed [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-4 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </CardContent>
    </Card>
  );
}
