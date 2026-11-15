import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_COLUMNS } from "../packages/core/src/config.js";
import { scrape } from "../packages/core/src/scrape.js";
import type { Source } from "../packages/core/src/sources/base.js";
import { TurismoMuniSource } from "../packages/core/src/sources/turismoMuni.js";
import { dataPaths, loadEvents } from "../packages/core/src/store.js";
import { fixture } from "./helpers.js";

const gviz = fixture("gviz_response.txt");
const NOW = new Date("2026-11-12T12:00:00.000Z");

/** Simula que la Municipalidad borró la última fila de la planilla. */
function gvizWithoutLastRow(text: string): string {
  const payload = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  payload.table.rows = payload.table.rows.slice(0, -1);
  return `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(payload)});`;
}

function fixtureSource(text = gviz): Source {
  const impl = new TurismoMuniSource();
  return {
    id: impl.id,
    name: impl.name,
    fetch: async (now: string) => impl.fromText(text, now),
  };
}

describe("pipeline de scrape sobre el fixture real", () => {
  it("normaliza la planilla completa", () => {
    const fetched = new TurismoMuniSource().fromText(gviz, NOW.toISOString());
    expect(fetched.columns).toEqual([...EXPECTED_COLUMNS]);
    expect(fetched.events.length).toBeGreaterThan(50);
    for (const event of fetched.events) {
      expect(event.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-03:00$/);
      expect(event.id).toHaveLength(12);
      if (event.end) expect(event.end >= event.start).toBe(true);
    }
    // sin ids duplicados
    expect(new Set(fetched.events.map((e) => e.id)).size).toBe(fetched.events.length);
  });

  it("escribe raw/events/changes/status y es idempotente", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cordoba-scrape-"));
    const paths = dataPaths(dir);

    const first = await scrape({ paths, source: fixtureSource(), now: NOW });
    expect(first.rawFile).toBe(join(paths.raw, "2026-11-12.json"));
    expect(first.status.counts.added).toBe(first.status.counts.active);
    expect(first.status.scraped).toBe(true);
    expect(JSON.parse(await readFile(join(paths.raw, "2026-11-12.json"), "utf8")).status).toBe(
      "ok",
    );

    const afterFirst = await readFile(paths.events, "utf8");
    const changesAfterFirst = (await readFile(paths.changes, "utf8")).trim().split("\n").length;

    const later = new Date("2026-11-13T12:00:00.000Z");
    const second = await scrape({ paths, source: fixtureSource(), now: later });
    expect(second.status.counts).toMatchObject({ added: 0, updated: 0, removed: 0, readded: 0 });
    const changesAfterSecond = (await readFile(paths.changes, "utf8")).trim().split("\n").length;
    expect(changesAfterSecond).toBe(changesAfterFirst);

    // lo único que cambia es last_seen
    const afterSecond = await readFile(paths.events, "utf8");
    expect(afterSecond).not.toBe(afterFirst);
    const strip = (t: string) => t.replace(/"last_seen":"[^"]+"/g, '"last_seen":"X"');
    expect(strip(afterSecond)).toBe(strip(afterFirst));

    // una baja real se registra
    const subset = gvizWithoutLastRow(gviz);
    const third = await scrape({ paths, source: fixtureSource(subset), now: later });
    expect(third.status.counts.removed).toBeGreaterThan(0);
    const reloaded = await loadEvents(paths);
    expect(reloaded.some((e) => !e.active)).toBe(true);
  });
});
