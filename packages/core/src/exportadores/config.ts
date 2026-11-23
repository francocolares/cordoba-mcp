export const EXPORTADORES_SOURCE_ID = "procordoba" as const;

export const EXPORTADORES_SOURCE_NAME =
  "Directorio de Exportadores – Agencia ProCórdoba S.E.M." as const;

export const EXPORTADORES_BASE = "https://www.exportadoresdecordoba.com" as const;

export const EXPORTADORES_SOURCE_URL = `${EXPORTADORES_BASE}/directorio.php`;

export const EXPORTADORES_CONTENT_SIGNAL = "search=yes, ai-train=no, use=reference";

export const EXPORTADORES_LICENSE =
  "sin términos publicados; el robots.txt del sitio declara " +
  "Content-Signal: search=yes, ai-train=no, use=reference";

export const EXPORTADORES_ATTRIBUTION = `Datos del Directorio de Exportadores de la Agencia ProCórdoba (${EXPORTADORES_BASE})`;

export const companyUrl = (externalId: string): string =>
  `${EXPORTADORES_BASE}/single.php?search=${externalId}`;

export const EXPORTER_PROFILES = [
  "Exportadora Habitual",
  "Exportadora Ocasional",
  "No Exporta / Próxima a Exportar",
] as const;

export const UNRESOLVED_PROFILE = "status_" as const;

export const RESTRICTED_BY_SOURCE = [
  "posiciones arancelarias",
  "cámaras",
  "datos de contacto",
] as const;

export const SOURCE_MASK = "(Acceso con usuario)" as const;

export const EXPORTADORES_NOTES = [
  "El directorio lista empresas que se inscribieron en ProCórdoba declarando oferta exportable: " +
    "no es el padrón de las empresas de Córdoba, y no estar no dice nada de la empresa.",
  "No se publican las fichas cuya razón social es el nombre de una persona humana " +
    "(monotributistas y unipersonales): es dato personal (Ley 25.326). Por eso el total publicado " +
    "es menor al del directorio; el recorte está contado en source_status.",
  `La fuente exige sesión para ${RESTRICTED_BY_SOURCE.join(", ")}: no se extraen, y cada ficha ` +
    "declara en restricted_fields qué le faltó.",
  "Un exporter_profile en null es un dato que la fuente no resuelve en su propio template, no una " +
    "empresa sin perfil declarado.",
  "Es un padrón, no un feed: crawled_at es la fecha del último recorrido completo del directorio.",
  EXPORTADORES_ATTRIBUTION,
] as const;

export const CRAWL_DELAY_MS = 1500;

export const CRAWL_JITTER_MS = 500;

export const CRAWL_RETRY_WAITS_MS = [5_000, 20_000, 60_000];
