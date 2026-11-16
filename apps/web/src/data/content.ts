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
  responde: string;
  lista: boolean;
  nota: string;
};

/**
 * Las activas van primero (de eso se encarga el sort del build) y las
 * pendientes ordenadas por relevancia: arriba las que más suman cruzadas con
 * lo que ya contestamos, abajo las que valen por sí solas pero no se cruzan
 * con nada.
 *
 * La `nota` es el conteo real y lo completa el build, así que sólo la llevan
 * las activas: la grilla cuenta la intención de mapear estos datos, no en qué
 * estado está cada relevamiento.
 */
export const fuentes: Fuente[] = [
  {
    nombre: "Agenda de eventos",
    organismo: SOURCE_NAME,
    enlace: AGENDA_URL,
    responde:
      "Qué hay para hacer hoy, mañana o el finde: recitales, teatro, ferias, visitas guiadas, cosas para ir con chicos.",
    lista: true,
    nota: "",
  },
  {
    nombre: "Farmacias de turno",
    organismo: "Colegio de Farmacéuticos de la Provincia de Córdoba",
    enlace: FARMACIAS_SOURCE_URL,
    responde:
      "Cuál está de guardia hoy y cuál te queda más cerca, con el cronograma de todo el año.",
    lista: true,
    nota: "",
  },
  {
    nombre: "Centros de salud y guardias",
    organismo: "Municipalidad de Córdoba y Ministerio de Salud de la Provincia",
    enlace: null,
    responde:
      "Qué dispensario o guardia está abierto ahora y cuál te queda más cerca, además de la farmacia de turno.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Colectivos",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    responde: "Qué línea te deja donde vas y dónde está la parada.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Cine y cartelera",
    organismo: "Cineclub Municipal y salas de la ciudad",
    enlace: null,
    responde: "Qué se da hoy y a qué hora, en los cines y en las salas independientes.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Teatros y museos de la Provincia",
    organismo: "Agencia Córdoba Cultura",
    enlace: null,
    responde: "La programación de las salas y los museos provinciales, que hoy queda afuera.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Fiestas y festivales de la provincia",
    organismo: "Agencia Córdoba Turismo",
    enlace: null,
    responde:
      "Cuándo es Cosquín, la Doma de Jesús María o la fiesta del pueblo, con la fecha oficial.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Centros culturales y bibliotecas",
    organismo: "Municipalidad de Córdoba y bibliotecas populares",
    enlace: null,
    responde:
      "Qué pasa en los centros vecinales y las bibliotecas del barrio, que no llega a la agenda grande.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Atracciones naturales",
    organismo: "Agencia Córdoba Turismo y Secretaría de Ambiente",
    enlace: null,
    responde:
      "Qué cascada, cerro o reserva te queda a mano para el día, cómo se llega y si hace falta permiso o guía.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Espacios verdes y plazas",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    responde: "Qué parque o plaza tenés cerca, con qué tiene y si hay feria o actividad ese día.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Obras y cortes de calle",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    responde: "Qué calle está cortada hoy, para no mandarte a una cuadra que no se puede pasar.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Polideportivos y natatorios",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    responde: "Dónde hay pileta, cancha o colonia, en qué horario y cuánto sale.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Barrios y límites oficiales",
    organismo: "Municipalidad de Córdoba e IDECOR",
    enlace: null,
    responde:
      "Qué barrio es cada dirección, para contestar por zona y no sólo por distancia en línea recta.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Direcciones y coordenadas",
    organismo: "Mapa Cultural (SInCA) y Georef",
    enlace: null,
    responde: "Dónde queda cada sala para poder contestar qué hay cerca de donde estás.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Ferias de barrio",
    organismo: "Centros vecinales",
    enlace: null,
    responde: "Qué días hay feria de productores y en qué plaza.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Estacionamiento medido",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    responde: "Dónde se puede dejar el auto cerca de donde vas y en qué horario se paga.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Trámites",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    responde: "Dónde se hace cada cosa, qué papeles llevar y hasta qué hora atienden.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Boletín Oficial",
    organismo: "Municipalidad de Córdoba",
    enlace: null,
    responde:
      "Qué ordenanza, decreto o licitación se publicó, para poder contestar qué cambió y desde cuándo rige.",
    lista: false,
    nota: "",
  },
  {
    nombre: "Catastro y valores de suelo",
    organismo: "IDECOR y Dirección de Catastro de la Provincia",
    enlace: null,
    responde:
      "Qué parcela es cada lote, cómo está zonificado y cuánto vale el suelo en esa cuadra.",
    lista: false,
    nota: "",
  },
];
