import type { Publisher } from "@skill-registry/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSkills } from "@/hooks/use-skills";
import { apiErrorMessage } from "@/lib/api";
import { formatMoment } from "@/lib/utils";

function formatPublisher(publisher: Publisher): string {
  if (publisher.first_name && publisher.last_name) return `${publisher.first_name} ${publisher.last_name}`;
  return publisher.email;
}

export function SkillList({
  canPublish,
  onSelect,
  onPublish,
}: {
  canPublish: boolean;
  onSelect: (name: string) => void;
  onPublish: () => void;
}) {
  const [page, setPage] = useState(1);
  const skills = useSkills(page);
  const totalPages = skills.data ? Math.max(1, Math.ceil(skills.data.total / skills.data.page_size)) : 1;

  return (
    <Card className="w-full max-w-4xl">
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        <CardDescription>Most recently published first.</CardDescription>
        {canPublish && (
          <CardAction>
            <Button onClick={onPublish}>Publish a Skill</Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {skills.isError && <p className="text-sm text-destructive">{apiErrorMessage(skills.error)}</p>}
        {skills.isSuccess && skills.data.items.length === 0 && (
          <p className="text-sm text-muted-foreground">No Skills published yet.</p>
        )}
        {skills.isSuccess && skills.data.items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Publisher</TableHead>
                <TableHead>Published</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.data.items.map((skill) => (
                <TableRow key={skill.name} className="cursor-pointer" onClick={() => onSelect(skill.name)}>
                  <TableCell className="font-medium">{skill.name}</TableCell>
                  <TableCell className="max-w-xs truncate whitespace-normal">{skill.description}</TableCell>
                  <TableCell>{formatPublisher(skill.published_by)}</TableCell>
                  <TableCell>{formatMoment(skill.published_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {skills.data && skills.data.total > skills.data.page_size && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
