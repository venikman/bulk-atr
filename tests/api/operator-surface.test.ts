import { describe, expect, it } from "../test-deps.ts";

const repoRoot = new URL("../../", import.meta.url);

describe("operator surface", () => {
  it("uses deno.json as the only tracked runtime/tooling config", async () => {
    const denoConfig = JSON.parse(
      await Deno.readTextFile(new URL("deno.json", repoRoot)),
    ) as {
      imports?: Record<string, string>;
      tasks?: Record<string, string>;
      nodeModulesDir?: string;
    };
    const postmanRunnerSource = await Deno.readTextFile(
      new URL("scripts/postman.ts", repoRoot),
    );

    expect(denoConfig.nodeModulesDir).toBeUndefined();
    expect(denoConfig.imports).toMatchObject({
      hono: expect.stringContaining("@hono/hono"),
      postgres: expect.stringContaining("npm:postgres"),
      "pg-mem": expect.stringContaining("npm:pg-mem"),
    });
    expect(denoConfig.tasks).toMatchObject({
      dev: expect.stringContaining("deno run"),
      start: expect.stringContaining("deno run"),
      test: expect.stringContaining("deno test"),
      check: expect.stringContaining("deno fmt"),
      "db:migrate": expect.stringContaining("scripts/migrate.ts"),
      postman: expect.stringContaining("scripts/postman.ts"),
      "postman:prod": expect.stringContaining("deno task postman"),
      "postman:local": expect.stringContaining("deno task postman"),
    });
    expect(denoConfig.tasks?.postman).not.toContain("npx");
    expect(postmanRunnerSource).not.toContain("newman");
    expect(postmanRunnerSource).not.toContain("npx");
  });

  it("removes Node/Vercel project config files from the tracked operator surface", async () => {
    await expect(Deno.stat(new URL("package.json", repoRoot))).rejects
      .toThrow();
    await expect(Deno.stat(new URL("package-lock.json", repoRoot))).rejects
      .toThrow();
    await expect(Deno.stat(new URL("tsconfig.json", repoRoot))).rejects
      .toThrow();
    await expect(Deno.stat(new URL("tsconfig.server.json", repoRoot))).rejects
      .toThrow();
    await expect(Deno.stat(new URL("vercel.json", repoRoot))).rejects.toThrow();
    await expect(Deno.stat(new URL("justfile", repoRoot))).rejects.toThrow();
  });
});
