import { describe, expect, it } from "bun:test";
import { registryNamespace } from "@in-org-quicko/skillset-shared";
import { PLUGIN_INSTALL_GUIDES } from "../src/lib/plugin-install";

const ORIGIN = "https://skills.acme.com";
const CLI = `npx @in-org-quicko/skillset-cli plugins install review-suite`;

describe("Plugin install guides", () => {
  it("installs for Claude Code through the Skillset CLI", () => {
    const guide = PLUGIN_INSTALL_GUIDES["claude-code"]({
      name: "review-suite",
      namespace: registryNamespace(ORIGIN),
      origin: ORIGIN,
    });
    expect(guide.steps.map((step) => step.command)).toEqual([`${CLI} --agent claude-code`]);
    expect(guide.note).not.toMatch(/HTTPS/);
  });

  it("names the namespace of a plugin imported from elsewhere", () => {
    const guide = PLUGIN_INSTALL_GUIDES.cursor({
      name: "review-suite",
      namespace: "acme/plugins",
      origin: ORIGIN,
    });
    expect(guide.steps[0]?.command).toBe(`${CLI} --namespace acme/plugins --agent cursor`);
  });

  it("warns when the Registry is not on HTTPS, since Claude Code will not download over HTTP", () => {
    const guide = PLUGIN_INSTALL_GUIDES["claude-code"]({
      name: "review-suite",
      namespace: registryNamespace("http://localhost:3000"),
      origin: "http://localhost:3000",
    });
    expect(guide.note).toMatch(/HTTPS/);
  });
});
