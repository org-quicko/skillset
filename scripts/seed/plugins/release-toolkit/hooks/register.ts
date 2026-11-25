import type { Register } from "claude-code";

export const register: Register = (on) => {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const result = await next(e);
    $.ui.status("release-toolkit: last command finished");
    return result;
  });
};
