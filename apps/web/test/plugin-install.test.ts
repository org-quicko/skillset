import { describe, expect, it } from "bun:test";
import { registryNamespace } from "@in-org-quicko/skillset-shared";
import { PLUGIN_INSTALL_GUIDES } from "../src/lib/plugin-install";

const ORIGIN = "https://skills.acme.com";

describe("Claude Code install guide", () => {
  it("adds this Registry's marketplace, then installs the plugin by its plain name when published here", () => {
    const guide = PLUGIN_INSTALL_GUIDES["claude-code"]({
      name: "review-suite",
      namespace: registryNamespace(ORIGIN),
      origin: ORIGIN,
    });
    expect(guide.steps.map((step) => step.command)).toEqual([
      "claude plugin marketplace add https://skills.acme.com/.claude-plugin/marketplace.json",
      "claude plugin install review-suite@skillset",
    ]);
    expect(guide.note).toBeUndefined();
  });

  it("names a plugin imported from elsewhere with its namespace, so it cannot clash with one published here", () => {
    const guide = PLUGIN_INSTALL_GUIDES["claude-code"]({ name: "review-suite", namespace: "acme/plugins", origin: ORIGIN });
    expect(guide.steps[1]?.command).toBe("claude plugin install review-suite--acme-plugins@skillset");
  });

  it("warns when the Registry is not on HTTPS, since Claude Code will not download over HTTP", () => {
    const guide = PLUGIN_INSTALL_GUIDES["claude-code"]({
      name: "review-suite",
      namespace: registryNamespace("http://localhost:3000"),
      origin: "http://localhost:3000",
    });
    expect(guide.note).toBeDefined();
  });
});
