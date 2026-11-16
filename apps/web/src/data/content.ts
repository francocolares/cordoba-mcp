import { AGENDA_URL, FARMACIAS_SOURCE_URL, SOURCE_NAME } from "@cordoba/core";

export const ENDPOINT = "https://cordobamcp.com/mcp";
export const REPO = "https://github.com/francocolares/cordoba-mcp";
/** Invitación a la comunidad. TODO: reemplazar por el invite definitivo. */
export const DISCORD = "https://discord.gg/cordoba-mcp";
/** Casilla de contacto. TODO: reemplazar por la dirección definitiva. */
export const CONTACTO = "hola@cordobamcp.com";

export type Cliente = {
  /** Ancla a la que apuntan los botones del hero. */
  id: string;
  icono: "claude-icon" | "openai-icon";
  nombre: string;
  detalle: string;
  pasos: string[];
  aviso: string | null;
};

export const clientes: Cliente[] = [
  {
    id: "claude",
    icono: "claude-icon",
    nombre: "Claude",
    detalle: "Se agrega una sola vez y queda en todos tus chats, también en el celular.",
    pasos: [
      "Abrí Configuración y entrá a Conectores.",
      "Elegí Agregar conector personalizado y pegá la dirección.",
      "Prendelo desde el menú de herramientas cuando lo quieras usar.",
    ],
    aviso: null,
  },
  {
    id: "chatgpt",
    icono: "openai-icon",
    nombre: "ChatGPT",
    detalle: "Hay que destrabar una opción que está medio escondida en la configuración.",
    pasos: [
      "En Configuración, entrá a Conectores, abrí Avanzado y prendé el modo desarrollador.",
      "Creá un conector nuevo, pegá la dirección y no toques nada más.",
      "Elegilo en el selector de herramientas cuando escribís.",
    ],
    aviso: "El modo desarrollador viene con los planes pagos.",
  },
];

export type Fuente = {
  nombre: string;
  organismo: string;
  enlace: string | null;
  lista: boolean;
};

/**
 * Las activas van primero (de eso se encarga el sort del build) y las
 * pendientes ordenadas por relevancia: arriba las que más suman cruzadas con
 * lo que ya contestamos, abajo las que valen por sí solas pero no se cruzan
 * con nada.
 */
export const fuentes: Fuente[] = [
  {
    nombre: "Agenda de eventos",
    organismo: SOURCE_NAME,
    enlace: AGENDA_URL,
    lista: true,
  },
  {
    nombre: "Farmacias de turno",
    organismo: "Colegio de Farmacéuticos de la Provincia de Córdoba",
    enlace: FARMACIAS_SOURCE_URL,
    lista: true,
  },
  {
    nombre: "Centros de salud y guardias",
    organismo: "Municipalidad de Córdoba y Ministerio de Salud de la Provincia",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Colectivos",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Cine y cartelera",
    organismo: "Cineclub Municipal y salas de la ciudad",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Teatros y museos de la Provincia",
    organismo: "Agencia Córdoba Cultura",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Fiestas y festivales de la provincia",
    organismo: "Agencia Córdoba Turismo",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Centros culturales y bibliotecas",
    organismo: "Municipalidad de Córdoba y bibliotecas populares",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Atracciones naturales",
    organismo: "Agencia Córdoba Turismo y Secretaría de Ambiente",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Espacios verdes y plazas",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Obras y cortes de calle",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Polideportivos y natatorios",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Barrios y límites oficiales",
    organismo: "Municipalidad de Córdoba e IDECOR",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Direcciones y coordenadas",
    organismo: "Mapa Cultural (SInCA) y Georef",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Ferias de barrio",
    organismo: "Centros vecinales",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Estacionamiento medido",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Trámites",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Boletín Oficial",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    lista: false,
  },
  {
    nombre: "Catastro y valores de suelo",
    organismo: "IDECOR y Dirección de Catastro de la Provincia",
    enlace: null,
    lista: false,
  },
];
