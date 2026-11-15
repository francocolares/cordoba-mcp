import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Event } from "../packages/core/src/models.js";
import { contentHash } from "../packages/core/src/normalize.js";
import {
  appendChanges,
  dataPaths,
  loadEvents,
  merge,
  saveEvents,
  serializeEvents,
} from "../packages/core/src/store.js";

const T1 = "2026-11-10T09:00:00.000Z";
const T2 = "2026-11-11T09:00:00.000Z";
const T3 = "2026-11-12T09:00:00.000Z";

function event(id: string, overrides: Partial<Event> = {}): Event {
  const base = {
    title: `Evento ${id}`,
    description: null,
    category_raw: "Música",
    category: "musica" as const,
    start: "2026-11-20T20:00:00-03:00",
    end: null,
    all_day: false,
    venue: "Plaza España",
    organizer: null,
    ticket_url: null,
    price_type: "gratis" as const,
    price_raw: "0",
    is_permanent: false,
    permanent_schedule: null,
    image_url: null,
    status_raw: "1",
    ...overrides,
  };
  return {
    id,
    source: "turismo_muni",
    source_row: 0,
    ...base,
    active: true,
    first_seen: T1,
    last_seen: T1,
    content_hash: contentHash(base),
  };
}

describe("merge", () => {
  it("da de alta eventos nuevos", () => {
    const { events, changes, counts } = merge([], [event("a"), event("b")], T1);
    expect(events).toHaveLength(2);
    expect(changes.map((c) => c.kind)).toEqual(["added", "added"]);
    expect(counts).toMatchObject({ added: 2, active: 2, total: 2 });
  });

  it("no genera cambios si corre dos veces con los mismos datos", () => {
    const first = merge([], [event("a")], T1);
    const second = merge(first.events, [event("a")], T2);
    expect(second.changes).toEqual([]);
    expect(second.events[0]?.first_seen).toBe(T1);
    expect(second.events[0]?.last_seen).toBe(T2);
  });

  it("registra updated con el diff de campos", () => {
    const first = merge([], [event("a")], T1);
    const changed = event("a", {
      venue: "Teatro Real",
      price_raw: "Con costo",
      price_type: "pago",
    });
    const second = merge(first.events, [changed], T2);
    expect(second.changes).toHaveLength(1);
    expect(second.changes[0]).toMatchObject({ kind: "updated", id: "a" });
    expect(second.changes[0]?.fields).toMatchObject({
      venue: ["Plaza España", "Teatro Real"],
      price_type: ["gratis", "pago"],
    });
  });

  it("da de baja una sola vez y marca readded al volver", () => {
    const s1 = merge([], [event("a"), event("b")], T1);
    const s2 = merge(s1.events, [event("a")], T2);
    expect(s2.changes.map((c) => c.kind)).toEqual(["removed"]);
    expect(s2.events.find((e) => e.id === "b")?.active).toBe(false);
    expect(s2.counts).toMatchObject({ active: 1, inactive: 1, removed: 1 });

    const s3 = merge(s2.events, [event("a")], T3);
    expect(s3.changes).toEqual([]); // no vuelve a registrar removed

    const s4 = merge(s3.events, [event("a"), event("b")], T3);
    expect(s4.changes.map((c) => c.kind)).toEqual(["readded"]);
    expect(s4.events.find((e) => e.id === "b")?.active).toBe(true);
    expect(s4.events.find((e) => e.id === "b")?.first_seen).toBe(T1);
  });
});

describe("persistencia", () => {
  it("serializa ordenado por id para diffs estables", () => {
    const text = serializeEvents([event("zz"), event("aa"), event("mm")]);
    const ids = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["aa", "mm", "zz"]);
  });

  it("round-trip de events.jsonl y append de changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cordoba-store-"));
    const paths = dataPaths(dir);
    expect(await loadEvents(paths)).toEqual([]);

    const { events, changes } = merge([], [event("a"), event("b")], T1);
    await saveEvents(events, paths);
    await appendChanges(changes, paths);
    await appendChanges(changes, paths);

    const reloaded = await loadEvents(paths);
    expect(reloaded).toEqual(events.sort((x, y) => (x.id < y.id ? -1 : 1)));
    const log = await readFile(paths.changes, "utf8");
    expect(log.trim().split("\n")).toHaveLength(4);
  });
});
