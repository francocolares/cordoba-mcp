import { readFileSync } from "node:fs";
import { join } from "node:path";

export const fixturesDir = join(import.meta.dirname, "fixtures");

export function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}
