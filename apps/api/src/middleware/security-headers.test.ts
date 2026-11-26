import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { spaContentSecurityPolicy, spaPolicy } from "./security-headers.js";

const connectSrc = (policy: string) => policy.split("; ").find((directive) => directive.startsWith("connect-src"));

describe("spaPolicy", () => {
  it("lets the interface reach storage and read public repositories from every Git Provider", () => {
    expect(connectSrc(spaPolicy("http://localhost:9000"))).toBe(
      "connect-src 'self' http://localhost:9000 https://api.github.com https://raw.githubusercontent.com https://gitlab.com",
    );
  });

  it("falls back to any https origin when storage is AWS's own endpoint", () => {
    expect(connectSrc(spaPolicy(undefined))).toStartWith("connect-src 'self' https: ");
  });
});

describe("spaContentSecurityPolicy", () => {
  const app = new Hono()
    .use("*", spaContentSecurityPolicy())
    .get("/", (c) => c.html("<!doctype html>"))
    .get("/assets/index.js", (c) => c.body("", 200, { "content-type": "text/javascript" }));

  it("makes browsers revalidate the HTML shell, so a redeploy is picked up on reload", async () => {
    const res = await app.request("/");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("content-security-policy")).not.toBeNull();
  });

  it("leaves hashed assets cacheable", async () => {
    const res = await app.request("/assets/index.js");
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
