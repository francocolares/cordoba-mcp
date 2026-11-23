import { AGENDA_URL, FARMACIAS_SOURCE_URL, SOURCE_NAME } from "@cordoba/core";
import type { ContribIconName, CtaIconName, SourceIconName } from "../lib/iconos";

export const ENDPOINT = "https://cordobamcp.com/mcp";
export const REPO = "https://github.com/francocolares/cordoba-mcp";
/** Invitación al grupo de WhatsApp de la comunidad. */
export const COMUNIDAD = "https://chat.whatsapp.com/GvyIE2o8rCI6dYL2M2dJNV";
const embedVimeo = (id: string) =>
  `https://player.vimeo.com/video/${id}?controls=0&title=0&byline=0&portrait=0&pip=0&keyboard=0&dnt=1&autoplay=1&playsinline=1`;
export const VIDEO_PRESENTACION = embedVimeo("1248508965");
export const VIDEO_EMPRESAS = embedVimeo("1248776752");
/** Casilla de contacto del proyecto. */
export const CONTACTO = "hola@fecocode.com";
export const BAJA_DATOS = `mailto:${CONTACTO}?subject=${encodeURIComponent(
  "Solicitud de baja de datos en Córdoba MCP",
)}`;
/** Agenda para la reunión inicial con una empresa. */
export const CITA = "https://cal.com/franco-colares/mcp-kickoff";
/**
 * Contacto de sponsors por WhatsApp, con el mensaje ya redactado: quien llega
 * desde acá no tiene que explicar de dónde viene ni qué quiere. `wa.me` pide
 * el número sin `+` ni separadores.
 */
export const SPONSOR_WHATSAPP = `https://wa.me/543546436319?text=${encodeURIComponent(
  "¡Hola Franco! Te escribo desde la web de Córdoba MCP. Quiero ser sponsor del proyecto.",
)}`;
/** Zifos, el estudio que sostiene el proyecto y presta los servicios. */
export const ZIFOS = "https://zifos.dev/";

/** Instructivo oficial de Anthropic para conectores personalizados (MCP remoto). */
export const CLAUDE_DOCS =
  "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp";

export type Paso = {
  titulo: string;
  detalle: string;
};

/**
 * El alta se hace una sola vez desde Claude en la web, y el conector queda
 * disponible en todos los clientes (web, escritorio y celular). Los nombres de
 * los menús van como los muestra Claude en español, con el rótulo en inglés
 * entre paréntesis porque la interfaz no siempre está traducida.
 */
export const pasosClaude: Paso[] = [
  {
    titulo: "Abrí Personalizar (Customize) → Conectores",
    detalle:
      "Desde Claude en la web, en claude.ai/customize/connectors. El alta se hace una vez acá, no en el celular.",
  },
  {
    titulo: "Elegí Agregar → Agregar conector personalizado",
    detalle: "Ponele el nombre que quieras: es el que vas a ver después en la lista de conectores.",
  },
  {
    titulo: "Pegá la dirección y seguí",
    detalle:
      "Dejá la autenticación como viene: el servidor es público y de solo lectura, así que no hace falta iniciar sesión ni cargar claves. Confirmá con Agregar.",
  },
  {
    titulo: "Prendelo en el chat",
    detalle:
      "Abrí el + abajo del cuadro de texto, entrá a Conectores y activá el conector cuando quieras preguntar por Córdoba.",
  },
];

export type Via = {
  id: string;
  /** Rótulo chico arriba del título: a quién se dirige la vía. */
  rotulo: string;
  titulo: string;
  icono: ContribIconName;
  /** Una o dos oraciones: qué es y por qué hace falta. */
  cuerpo: string;
  /** Lo concreto que incluye cada vía. */
  puntos: string[];
  /**
   * El destino decide si el enlace abre en otra pestaña: `mailto:` y los
   * anclajes se quedan acá. Así el día que `CITA` pase de correo a calendario
   * no hay que acordarse de tocar un segundo campo.
   */
  cta: {
    texto: string;
    href: string;
    /** Marca del canal que abre el botón, cuando no es obvio por el texto. */
    marca?: "whatsapp-monochrome-icon";
    /** Ícono de trazo, para lo que no tiene marca propia. */
    icono?: CtaIconName;
  };
  video?: { texto: string; titulo: string; fuente: string };
  /**
   * Pinta la ficha con el acento naranja. La lleva una sola de las dos: si las
   * dos resaltan, ninguna se lee primero.
   */
  destacada: boolean;
};

/**
 * Las dos líneas de contribución. El sponsoreo va primero porque está abierto
 * a cualquiera; los servicios después, que es la vía que financia el resto.
 */
export const vias: Via[] = [
  {
    id: "sponsor",
    rotulo: "Sponsors",
    titulo: "Ser sponsor del proyecto",
    icono: "heart-handshake",
    cuerpo:
      "Cada fuente cuesta relevarla, validarla y corregirla cuando cambia el origen, más la infraestructura que la sirve. Los sponsors cubren ese trabajo: por eso el proyecto sigue abierto y gratuito.",
    puntos: [
      "Código abierto y acceso gratuito a los datos",
      "Prioridad para pedir nuevas fuentes en el roadmap",
      "Padrinazgo: la fuente que sostiene queda declarada a su nombre",
      "Su nombre o logo, enlazado, acá y en el repositorio",
    ],
    cta: {
      texto: "Quiero ser sponsor",
      href: SPONSOR_WHATSAPP,
      marca: "whatsapp-monochrome-icon",
    },
    destacada: true,
  },
  {
    id: "servicios",
    rotulo: "Empresas",
    titulo: "Contratar nuestros servicios",
    icono: "server",
    cuerpo:
      "El mismo trabajo, puertas adentro: consolidar lo que hoy está disperso en planillas, bases y sistemas heredados, normalizarlo y dejarlo listo para que la inteligencia artificial lo consulte y lo cruce.",
    puntos: [
      "Relevamiento y normalización de sus fuentes a un modelo común",
      "Un servidor MCP privado, con sus propios controles de acceso",
      "Integración con Claude, ChatGPT o las apps que ya usa su equipo",
      "Capacitación del equipo para sacarle todo el provecho",
    ],
    cta: { texto: "Agendar una cita", href: CITA, icono: "calendar-check" },
    video: {
      texto: "Ver la presentación",
      titulo: "Video de presentación de Córdoba MCP para empresas",
      fuente: VIDEO_EMPRESAS,
    },
    destacada: false,
  },
];

export type Fuente = {
  /**
   * El id con el que la referencia una conversación del chat (ver
   * `conversaciones.ts`). Es la bisagra entre las dos secciones: el orden de
   * esta lista es el que termina usando el chat.
   */
  id: string;
  nombre: string;
  icono: SourceIconName;
  organismo: string;
  enlace: string | null;
  lista: boolean;
};

/**
 * Esta lista es la única que decide el orden de las dos secciones de la
 * landing: la grilla de fuentes y las pestañas del chat (ver `index.astro`).
 *
 * Las activas van primero —de eso se encarga el sort del build— y las
 * pendientes están ordenadas por impacto: arriba lo que a nadie se le ocurre
 * que un asistente pueda contestar (satélites, fuego, campo, economía, suelo),
 * porque es lo que muestra hasta dónde llega la idea; abajo lo cotidiano, que
 * se entiende solo y no necesita el primer lugar para convencer.
 */
export const fuentes: Fuente[] = [
  {
    id: "agenda",
    nombre: "Agenda de eventos",
    icono: "calendar-days",
    organismo: SOURCE_NAME,
    enlace: AGENDA_URL,
    lista: true,
  },
  {
    id: "farmacias",
    nombre: "Farmacias de turno",
    icono: "pill",
    organismo: "Colegio de Farmacéuticos de la Provincia de Córdoba",
    enlace: FARMACIAS_SOURCE_URL,
    lista: true,
  },
  {
    id: "satelites",
    nombre: "Observación de la Tierra",
    icono: "satellite",
    organismo: "Copernicus (ESA), NASA y CONAE",
    enlace: null,
    lista: false,
  },
  {
    id: "incendios",
    nombre: "Incendios y áreas quemadas",
    icono: "flame",
    organismo: "Sentinel, NASA FIRMS y SAOCOM, sobre el parte de la Provincia",
    enlace: null,
    lista: false,
  },
  {
    id: "agro",
    nombre: "Producción agropecuaria",
    icono: "wheat",
    organismo: "Ministerio de Bioagroindustria y Bolsa de Cereales de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    id: "economia",
    nombre: "Actividad económica y empleo",
    icono: "trending-up",
    organismo: "Dirección General de Estadística y Censos de la Provincia",
    enlace: null,
    lista: false,
  },
  {
    id: "exportadores",
    nombre: "Empresas exportadoras",
    icono: "container",
    organismo: "Agencia ProCórdoba",
    enlace: "https://www.exportadoresdecordoba.com/",
    lista: true,
  },
  {
    id: "catastro",
    nombre: "Catastro y valores de suelo",
    icono: "layers",
    organismo: "IDECOR y Dirección de Catastro de la Provincia",
    enlace: null,
    lista: false,
  },
  {
    id: "salud",
    nombre: "Centros de salud y guardias",
    icono: "hospital",
    organismo: "Municipalidad de Córdoba y Ministerio de Salud de la Provincia",
    enlace: null,
    lista: false,
  },
  {
    id: "colectivos",
    nombre: "Colectivos",
    icono: "bus",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    id: "cultura",
    nombre: "Teatros y museos de la Provincia",
    icono: "landmark",
    organismo: "Agencia Córdoba Cultura",
    enlace: null,
    lista: false,
  },
  {
    id: "festivales",
    nombre: "Fiestas y festivales de la provincia",
    icono: "ferris-wheel",
    organismo: "Agencia Córdoba Turismo",
    enlace: null,
    lista: false,
  },
  {
    id: "cine",
    nombre: "Cine y cartelera",
    icono: "film",
    organismo: "Cineclub Municipal y salas de la ciudad",
    enlace: null,
    lista: false,
  },
  {
    id: "obras",
    nombre: "Obras y cortes de calle",
    icono: "traffic-cone",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    id: "tramites",
    nombre: "Trámites",
    icono: "stamp",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    id: "boletin",
    nombre: "Boletín Oficial",
    icono: "newspaper",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    id: "centros-culturales",
    nombre: "Centros culturales y bibliotecas",
    icono: "library",
    organismo: "Municipalidad de Córdoba y bibliotecas populares",
    enlace: null,
    lista: false,
  },
  {
    id: "naturaleza",
    nombre: "Atracciones naturales",
    icono: "mountain-snow",
    organismo: "Agencia Córdoba Turismo y Secretaría de Ambiente",
    enlace: null,
    lista: false,
  },
  {
    id: "espacios-verdes",
    nombre: "Espacios verdes y plazas",
    icono: "trees",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    id: "polideportivos",
    nombre: "Polideportivos y natatorios",
    icono: "waves",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    id: "barrios",
    nombre: "Barrios y límites oficiales",
    icono: "map",
    organismo: "Municipalidad de Córdoba e IDECOR",
    enlace: null,
    lista: false,
  },
  {
    id: "ferias",
    nombre: "Ferias de barrio",
    icono: "shopping-basket",
    organismo: "Centros vecinales",
    enlace: null,
    lista: false,
  },
  {
    id: "estacionamiento",
    nombre: "Estacionamiento medido",
    icono: "circle-parking",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
];

export type Organismo = {
  nombre: string;
  logo: string;
  ancho: number;
  alto: number;
  escalaOptica: number;
  enlace: string;
};

export const ALTO_LOGO = 30;

export const organismos: Organismo[] = [
  {
    nombre: "Municipalidad de Córdoba",
    logo: "/logos/municipalidad-cordoba.png",
    ancho: 162,
    alto: 140,
    escalaOptica: 1.15,
    enlace: "https://cordoba.gob.ar/",
  },
  {
    nombre: "Colegio de Farmacéuticos de la Provincia de Córdoba",
    logo: "/logos/colegio-farmaceuticos.png",
    ancho: 573,
    alto: 140,
    escalaOptica: 1,
    enlace: FARMACIAS_SOURCE_URL,
  },
  {
    nombre: "Gobierno de la Provincia de Córdoba",
    logo: "/logos/provincia-cordoba.png",
    ancho: 854,
    alto: 140,
    escalaOptica: 0.88,
    enlace: "https://www.cba.gov.ar/",
  },
  {
    nombre: "Agencia Córdoba Turismo",
    logo: "/logos/cordoba-turismo.png",
    ancho: 1353,
    alto: 140,
    escalaOptica: 0.8,
    enlace: "https://cordobaturismo.gov.ar/",
  },
  {
    nombre: "Agencia ProCórdoba",
    logo: "/logos/procordoba.png",
    ancho: 560,
    alto: 140,
    escalaOptica: 1,
    enlace: "https://www.procordoba.org/",
  },
  {
    nombre: "IDECOR",
    logo: "/logos/idecor.png",
    ancho: 465,
    alto: 140,
    escalaOptica: 0.88,
    enlace: "https://www.idecor.gob.ar/",
  },
  {
    nombre: "CONAE",
    logo: "/logos/conae.png",
    ancho: 219,
    alto: 140,
    escalaOptica: 0.95,
    enlace: "https://www.argentina.gob.ar/ciencia/conae",
  },
  {
    nombre: "NASA",
    logo: "/logos/nasa.png",
    ancho: 140,
    alto: 140,
    escalaOptica: 1.15,
    enlace: "https://www.earthdata.nasa.gov/",
  },
  {
    nombre: "Agencia Espacial Europea",
    logo: "/logos/esa.png",
    ancho: 387,
    alto: 140,
    escalaOptica: 0.9,
    enlace: "https://www.copernicus.eu/",
  },
  {
    nombre: "Bolsa de Cereales de Córdoba",
    logo: "/logos/bolsa-cereales.png",
    ancho: 508,
    alto: 140,
    escalaOptica: 1,
    enlace: "https://www.bccba.org.ar/",
  },
  {
    nombre: "Cineclub Municipal Hugo del Carril",
    logo: "/logos/cineclub-municipal.png",
    ancho: 309,
    alto: 140,
    escalaOptica: 1,
    enlace: "https://cineclubmunicipal.org.ar/",
  },
];
