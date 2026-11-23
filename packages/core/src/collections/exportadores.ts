import {
  type Collection,
  type CollectionFiles,
  defineCollection,
  type SearchOutcome,
} from "../collections.js";
import {
  EXPORTADORES_CONTENT_SIGNAL,
  EXPORTADORES_LICENSE,
  EXPORTADORES_NOTES,
  EXPORTADORES_SOURCE_ID,
  EXPORTADORES_SOURCE_NAME,
  EXPORTADORES_SOURCE_URL,
  EXPORTER_PROFILES,
} from "../exportadores/config.js";
import type { ExportadoresStatus, Exporter } from "../exportadores/models.js";
import {
  countryCounts,
  profileCounts,
  searchExporters,
  sectorCounts,
  toExporterSummary,
} from "../exportadores/query.js";
import { formatId } from "../ids.js";
import { latestSeen, parseExportersJsonl, parseJsonOr } from "../jsonl.js";

export interface ExportadoresStore {
  exporters: Exporter[];
  status: ExportadoresStatus | null;
  data_as_of: string;
}

const row = (exporter: Exporter, fields: "summary" | "full"): Record<string, unknown> => {
  const id = formatId("exportadores", exporter.source, exporter.id);
  if (fields === "summary") return { ...toExporterSummary(exporter), id };
  return { ...exporter, id };
};

export const exportadores: Collection<unknown> = defineCollection<ExportadoresStore>({
  descriptor: {
    id: "exportadores",
    title: "Exportadores de Córdoba",
    description:
      "Empresas inscriptas en el Directorio de Exportadores de la Agencia ProCórdoba, con su " +
      "rubro, los países a los que exportan, su oferta exportable, su perfil exportador y su " +
      "sitio web. Sirve para buscar proveedores por rubro o por mercado de destino.",
    record: "empresa",
    supports: {
      text: true,
      near: false,
      date: "none",
      date_tokens: [],
      group_by: ["rubro", "pais_exporta", "perfil_exportador"],
      sort: ["nombre"],
      expand: [],
    },
    filters: [
      {
        name: "rubro",
        type: "string",
        description:
          "rubro declarado por la empresa; los valores con conteo salen de list_collections " +
          "(include: taxonomies)",
      },
      {
        name: "pais_exporta",
        type: "string",
        description: "país al que la empresa declara exportar",
      },
      {
        name: "perfil_exportador",
        type: "enum",
        values: EXPORTER_PROFILES,
        description: "qué tanto exporta, según lo declarado en la fuente",
      },
      {
        name: "con_sitio",
        type: "boolean",
        description: "true: sólo las que publican sitio web; false: sólo las que no",
      },
      {
        name: "include_inactive",
        type: "boolean",
        default: false,
        description: "incluir las empresas que ya no están en el directorio",
      },
    ],
    examples: [
      'search(collection:"exportadores", filters:{rubro:"Software"})',
      'search(collection:"exportadores", query:"mani", filters:{pais_exporta:"Brasil"})',
      'search(collection:"exportadores", group_by:"rubro")',
      'list_collections(collection:"exportadores", include:["taxonomies"])',
    ],
    notes: EXPORTADORES_NOTES,
    content_signal: EXPORTADORES_CONTENT_SIGNAL,
  },

  sources: (store) => [
    {
      id: EXPORTADORES_SOURCE_ID,
      name: EXPORTADORES_SOURCE_NAME,
      url: EXPORTADORES_SOURCE_URL,
      license: EXPORTADORES_LICENSE,
      data_as_of: store.data_as_of,
    },
  ],

  dataAsOf: (store) => store.data_as_of,

  status: (store) => ({
    status: store.status,
    records: store.exporters.length,
    active: store.exporters.filter((e) => e.active).length,
    with_website: store.exporters.filter((e) => e.active && e.website !== null).length,
    directory_total: store.status?.directory_total ?? null,
    excluded_natural_persons: store.status?.excluded_natural_persons ?? null,
    excluded_without_content: store.status?.excluded_without_content ?? null,
    crawled_at: store.status?.crawled_at ?? null,
    data_as_of: store.data_as_of,
  }),

  taxonomies: (store) => {
    const active = store.exporters.filter((e) => e.active);
    return {
      rubro: sectorCounts(active),
      pais_exporta: countryCounts(active),
      perfil_exportador: profileCounts(active),
    };
  },

  search: (store, request): SearchOutcome => {
    let matched = searchExporters(store.exporters, {
      query: request.query,
      rubro: request.filters["rubro"] as string | undefined,
      pais: request.filters["pais_exporta"] as string | undefined,
      perfil: request.filters["perfil_exportador"] as string | undefined,
      con_sitio: request.filters["con_sitio"] as boolean | undefined,
      include_inactive: request.filters["include_inactive"] === true,
    });

    if (request.source !== undefined) {
      matched = matched.filter((e) => e.source === request.source);
    }

    const groups =
      request.group_by === "rubro"
        ? sectorCounts(matched)
        : request.group_by === "pais_exporta"
          ? countryCounts(matched)
          : request.group_by === "perfil_exportador"
            ? profileCounts(matched)
            : undefined;

    return {
      rows: matched.map((exporter) => row(exporter, request.fields)),
      ...(groups === undefined ? {} : { groups }),
    };
  },

  dump: (store) => ({ jsonl: store.exporters, extras: { "status.json": store.status } }),

  hydrate: (files: CollectionFiles): ExportadoresStore | null => {
    if (files.records === null) return null;
    const exporters = parseExportersJsonl(files.records);
    const status = parseJsonOr<ExportadoresStatus>(files.extras["status.json"]);
    return {
      exporters,
      status,
      data_as_of: status?.crawled_at ?? status?.last_run ?? latestSeen(exporters) ?? "",
    };
  },

  get: (store, localIds, _expand) => {
    const found: Record<string, unknown>[] = [];
    const missing: string[] = [];
    for (const id of localIds) {
      const exporter = store.exporters.find((e) => e.id === id);
      if (exporter) found.push(row(exporter, "full"));
      else missing.push(id);
    }
    return { found, missing };
  },
});
