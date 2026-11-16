import type { ItemChat } from "../lib/demoEventos";

export type Chat = {
  pregunta: string;
  intro: string;
  items: ItemChat[];
  cierre: string;
};

export type Conversacion = {
  id: string;
  /** El rótulo de la pestaña. Corto: tiene que entrar en un celular. */
  etiqueta: string;
  /**
   * `false` sólo para lo que el MCP ya contesta de verdad. El resto se muestra
   * como ejemplo de hacia dónde va y se rotula "próximamente".
   */
  proximamente: boolean;
  /** Una línea: qué haría falta para que este ejemplo deje de ser un ejemplo. */
  caso: string | null;
  chat: Chat;
};

/**
 * Los items de "agenda" se reemplazan en el build y otra vez en el navegador
 * con lo que haya en la agenda real. Los demás son ilustrativos.
 *
 * El orden es el del relevamiento de fuentes: primero lo que ya anda, después
 * lo que tiene fuente verificada, y al final lo que todavía no tiene de dónde
 * salir.
 */
export const conversaciones: Conversacion[] = [
  {
    id: "agenda",
    etiqueta: "Eventos",
    proximamente: false,
    caso: null,
    chat: {
      pregunta: "¿Qué hay para hacer este fin de semana en Córdoba?",
      intro: "Hay bastante dando vueltas. Dos que te pueden interesar:",
      items: [],
      cierre: "Si preferís algo gratis, o para ir con chicos, te busco otras opciones.",
    },
  },
  {
    id: "festivales",
    etiqueta: "Festivales",
    proximamente: true,
    caso: "Fiestas y festivales de toda la provincia, con la fecha oficial, desde la agenda de Córdoba Turismo.",
    chat: {
      pregunta: "¿Cuándo es Cosquín este año? ¿Y la Doma de Jesús María?",
      intro: "Las dos caen en enero, con una semana de diferencia:",
      items: [
        {
          titulo: "Festival Nacional de Folklore de Cosquín",
          meta: "Del 24 de enero al 1 de febrero · Plaza Próspero Molina",
          etiqueta: "9 noches",
        },
        {
          titulo: "Festival Nacional de Doma y Folklore",
          meta: "Del 8 al 18 de enero · Anfiteatro José Hernández, Jesús María",
          etiqueta: null,
        },
      ],
      cierre: "Son las dos grandes, pero en enero hay fiesta casi todos los findes en el valle.",
    },
  },
  {
    id: "cultura",
    etiqueta: "Teatro",
    proximamente: true,
    caso: "La programación de las salas y los elencos provinciales, desde la agenda de la Agencia Córdoba Cultura.",
    chat: {
      pregunta: "¿Qué hay en el Teatro del Libertador y en el Real esta semana?",
      intro: "Las dos salas tienen función:",
      items: [
        {
          titulo: "Orquesta Sinfónica de Córdoba",
          meta: "Viernes 20:30 · Teatro del Libertador San Martín",
          etiqueta: null,
        },
        {
          titulo: "La Comedia Cordobesa presenta “Tres para un Bululú”",
          meta: "Jueves 20:30 · Teatro Real, San Jerónimo 66",
          etiqueta: "entradas $10.000",
        },
      ],
      cierre:
        "También hay muestras abiertas en el Caraffa y en el Buen Pastor, si querés algo de día.",
    },
  },
  {
    id: "colectivos",
    etiqueta: "Colectivos",
    proximamente: true,
    caso: "El GTFS del transporte urbano que publica la Municipalidad: la última versión es de 2023 y hay que esperar una nueva.",
    chat: {
      pregunta: "¿Qué colectivo me deja en el Patio Olmos?",
      intro: "Te sirven dos líneas:",
      items: [
        {
          titulo: "Línea 60",
          meta: "Parada en Vélez Sarsfield y Bv. San Juan · pasa cada 12 minutos",
          etiqueta: "te deja en la esquina",
        },
        {
          titulo: "Línea T2",
          meta: "Parada en Bv. San Juan al 100 · pasa cada 20 minutos",
          etiqueta: null,
        },
      ],
      cierre: "Desde el centro conviene la 60. ¿Querés el recorrido completo?",
    },
  },
  {
    id: "cine",
    etiqueta: "Cine",
    proximamente: true,
    caso: "La cartelera del Cineclub Municipal y de las salas independientes; falta una fuente que traiga los horarios.",
    chat: {
      pregunta: "¿Qué dan hoy en el Cineclub?",
      intro: "Hoy tiene dos funciones:",
      items: [
        {
          titulo: "Quinografía",
          meta: "En cartel hasta el miércoles 18 · estreno exclusivo",
          etiqueta: null,
        },
        {
          titulo: "Ciclo de cine argentino",
          meta: "Bv. San Juan 49 · función de la tarde y de la noche",
          etiqueta: null,
        },
      ],
      cierre: "Es sala chica, así que conviene sacar la entrada antes.",
    },
  },
  {
    id: "farmacias",
    etiqueta: "Farmacias",
    proximamente: false,
    caso: null,
    chat: {
      pregunta: "¿Qué farmacia está de turno ahora?",
      intro: "Hoy está de guardia una de estas, cerca del Centro:",
      items: [
        {
          titulo: "Farmacia de turno",
          meta: "El cronograma del Colegio de Farmacéuticos, día por día",
          etiqueta: null,
        },
      ],
      cierre:
        "El cronograma no publica el horario de la guardia, así que conviene llamar antes de ir.",
    },
  },
  {
    id: "tramites",
    etiqueta: "Trámites",
    proximamente: true,
    caso: "Dónde se hace cada trámite y qué papeles piden; todavía sin una fuente pública estable.",
    chat: {
      pregunta: "¿Dónde renuevo la licencia de conducir y qué tengo que llevar?",
      intro: "Se hace en el Centro de Emisión de Licencias:",
      items: [
        {
          titulo: "Av. Vélez Sarsfield 1800",
          meta: "Lunes a viernes de 8 a 14 · con turno previo",
          etiqueta: null,
        },
        {
          titulo: "Lo que piden",
          meta: "DNI, certificado de grupo sanguíneo y libre deuda de multas",
          etiqueta: null,
        },
      ],
      cierre: "El turno se saca online y hoy hay lugar para la semana que viene.",
    },
  },
];
