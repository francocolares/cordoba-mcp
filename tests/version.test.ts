import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_INFO, SERVER_VERSION } from "@cordoba/core";
import { describe, expect, it } from "vitest";
import { SERVER_INFO as WORKER_SERVER_INFO } from "../apps/worker/src/mcp.js";

const corePkg = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "packages", "core", "package.json"), "utf8"),
) as { version: string };

describe("versionado del servidor", () => {
  it("SERVER_VERSION sale de packages/core/package.json", () => {
    expect(SERVER_VERSION).toBe(corePkg.version);
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("stdio y Worker reportan el mismo serverInfo", () => {
    expect(WORKER_SERVER_INFO).toEqual(SERVER_INFO);
    expect(WORKER_SERVER_INFO.version).toBe(corePkg.version);
  });
});
