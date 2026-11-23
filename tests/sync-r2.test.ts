import { describe, expect, it } from "vitest";
import { planPublication } from "../apps/worker/scripts/sync-r2.mjs";

type Entry = { data_as_of: string; records: { key: string; hash: string }; extras: object };

const entry = (id: string, hash: string): Entry => ({
  data_as_of: "2026-11-23T00:00:00.000Z",
  records: { key: `${id}/records.jsonl`, hash },
  extras: {},
});

const plan = (
  local: readonly string[],
  publicadas: readonly string[],
  only: readonly string[] = [],
) =>
  planPublication({
    manifest: {
      version: 1,
      collections: Object.fromEntries(local.map((id) => [id, entry(id, "local")])),
    },
    objects: local.map((id) => ({ key: `${id}/records.jsonl` })),
    previous: {
      collections: Object.fromEntries(publicadas.map((id) => [id, entry(id, "publicado")])),
    },
    only,
  }) as {
    manifest: { collections: Record<string, Entry> };
    objects: { key: string }[];
    conservadas: string[];
    sinDatosLocales: string[];
  };

describe("planPublication", () => {
  it("conserva lo publicado de una colección que no está en el data/ local", () => {
    const result = plan(["eventos"], ["eventos", "exportadores"]);

    expect(Object.keys(result.manifest.collections).sort()).toEqual(["eventos", "exportadores"]);
    expect(result.manifest.collections.exportadores.records.hash).toBe("publicado");
    expect(result.manifest.collections.eventos.records.hash).toBe("local");
    expect(result.sinDatosLocales).toEqual(["exportadores"]);
    expect(result.objects.map((o) => o.key)).toEqual(["eventos/records.jsonl"]);
  });

  it("con --only publica esa colección y deja las demás como están arriba", () => {
    const result = plan(["eventos", "exportadores"], ["eventos", "exportadores"], ["exportadores"]);

    expect(result.manifest.collections.exportadores.records.hash).toBe("local");
    expect(result.manifest.collections.eventos.records.hash).toBe("publicado");
    expect(result.conservadas).toEqual(["eventos"]);
    expect(result.objects.map((o) => o.key)).toEqual(["exportadores/records.jsonl"]);
  });

  it("sin manifest previo publica sólo lo local", () => {
    const result = planPublication({
      manifest: { version: 1, collections: { eventos: entry("eventos", "local") } },
      objects: [{ key: "eventos/records.jsonl" }],
      previous: null,
    }) as { manifest: { collections: Record<string, Entry> }; sinDatosLocales: string[] };

    expect(Object.keys(result.manifest.collections)).toEqual(["eventos"]);
    expect(result.sinDatosLocales).toEqual([]);
  });
});
