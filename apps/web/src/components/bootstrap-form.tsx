import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSignup } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";

export function BootstrapForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signup = useSignup();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    signup.mutate({ first_name: firstName, last_name: lastName, email, password });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Set up the Registry</CardTitle>
        <CardDescription>You're the first to arrive — sign up and you'll be its Admin.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="first_name">First name</Label>
            <Input
              id="first_name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="last_name">Last name</Label>
            <Input id="last_name" value={lastName} onChange={(event) => setLastName(event.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {signup.isError && (
            <p className="text-sm text-destructive">
              {signup.error instanceof ApiError ? signup.error.message : "Something went wrong."}
            </p>
          )}
          <Button type="submit" disabled={signup.isPending}>
            {signup.isPending ? "Creating account…" : "Create Admin account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
