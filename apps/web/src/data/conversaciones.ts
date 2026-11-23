import type { ItemChat } from "../lib/demoEventos";

export type Chat = {
  pregunta: string;
  intro: string;
  items: ItemChat[];
  cierre: string;
};

export type Conversacion = {
  /**
   * El id de la fuente que contesta esta conversación: tiene que existir en
   * `fuentes` (ver `content.ts`), que es la que manda el orden de las
   * pestañas. `index.astro` lo verifica en el build.
   */
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
 * Los items de "agenda" y "farmacias" se reemplazan en el build y otra vez en
 * el navegador con los datos reales. Los demás son ilustrativos.
 *
 * El orden de este archivo no importa: las pestañas salen ordenadas como
 * `fuentes`, así que para mover una conversación de lugar hay que mover su
 * fuente.
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
    id: "satelites",
    etiqueta: "Satélites",
    proximamente: true,
    caso: "Las imágenes de Copernicus (ESA), la NASA y CONAE: están abiertas, pero la clasificación de cobertura hay que calcularla nosotros antes de poder contestar con ella.",
    chat: {
      pregunta: "¿Cuánto bosque nativo perdió Punilla en los últimos cinco años?",
      intro: "Comparando la cobertura de 2021 con la de este año:",
      items: [
        {
          titulo: "1.240 hectáreas menos de bosque nativo",
          meta: "Sentinel-2, series 2021–2026 · equivale a 60 veces el Parque Sarmiento",
          etiqueta: "−7,4%",
        },
        {
          titulo: "Dónde se concentra",
          meta: "El pie de sierra entre Villa Giardino y La Cumbre, sobre el borde de los loteos",
          etiqueta: null,
        },
      ],
      cierre:
        "Desde arriba se ve qué cambió, no si estaba permitido: para eso hay que cruzarlo con los permisos de la Provincia.",
    },
  },
  {
    id: "incendios",
    etiqueta: "Incendios",
    proximamente: true,
    caso: "El parte de incendios de la Provincia cruzado con los focos de calor de NASA FIRMS y las áreas quemadas que se ven en Sentinel y SAOCOM.",
    chat: {
      pregunta: "Alquilamos una cabaña en Los Cocos para el finde. ¿Hay riesgo de incendio?",
      intro: "Hoy la zona está para estar atento, no para cancelar:",
      items: [
        {
          titulo: "Un foco activo a 18 km, en la ladera este del Uritorco",
          meta: "Parte de la Provincia de las 8 · viento norte a 32 km/h y 18% de humedad",
          etiqueta: "activo",
        },
        {
          titulo: "Lo que ya se quemó alrededor",
          meta: "1.840 ha entre Los Cocos y La Cumbre en septiembre · nada nuevo desde entonces",
          etiqueta: null,
        },
      ],
      cierre:
        "El viento acá cambia en horas y el parte se actualiza dos veces por día: preguntame de nuevo antes de salir.",
    },
  },
  {
    id: "agro",
    etiqueta: "Campo",
    proximamente: true,
    caso: "Los partes de la Bolsa de Cereales de Córdoba y las estadísticas del Ministerio de Bioagroindustria, que hoy se publican en PDF.",
    chat: {
      pregunta: "¿Cómo cerró el trigo en el sur de la provincia?",
      intro: "Con el 65% del área trillada, en el departamento Río Cuarto:",
      items: [
        {
          titulo: "Rinde promedio de 34 quintales por hectárea",
          meta: "Parte de la Bolsa de Cereales del 12 de noviembre · la mejor campaña desde 2021",
          etiqueta: "+21%",
        },
        {
          titulo: "Lo que falta y lo que viene",
          meta: "Quedan 1,6 M ha por trillar en la provincia; el maíz tardío arranca con la lluvia de esta semana",
          etiqueta: null,
        },
      ],
      cierre: "Te lo abro por departamento, o te traigo las últimas cinco campañas para comparar.",
    },
  },
  {
    id: "economia",
    etiqueta: "Economía",
    proximamente: true,
    caso: "Las series de la Dirección General de Estadística y Censos de la Provincia, que hoy salen en planillas sueltas.",
    chat: {
      pregunta: "¿Los precios en Córdoba suben más que en el resto del país?",
      intro: "En octubre, no: el índice provincial quedó abajo del nacional.",
      items: [
        {
          titulo: "IPC Córdoba: 1,8% en el mes",
          meta: "Dirección General de Estadística y Censos · medio punto abajo del INDEC",
          etiqueta: "19,4% anual",
        },
        {
          titulo: "Lo que más empujó",
          meta: "Vivienda y servicios, 3,1% · lo que menos, indumentaria, 0,9%",
          etiqueta: null,
        },
      ],
      cierre:
        "La serie arranca en 2016: puedo mostrarte mes a mes, o pararla al lado del índice nacional.",
    },
  },
  {
    id: "exportadores",
    etiqueta: "Exportadores",
    proximamente: false,
    caso: null,
    chat: {
      pregunta: "Necesito proveedores de Córdoba que ya exporten aceite de maní a Europa.",
      intro: "Hay diez fichas con aceite de maní en la oferta y destinos en la Unión Europea. Dos:",
      items: [
        {
          titulo: "PRODEMAN S.A. - MANÍ KING",
          meta: "Aceites y oleaginosas · aceite de maní, maní confitería y pasta de maní · exporta a 22 países, entre ellos Alemania, Francia, Países Bajos y Polonia",
          etiqueta: "con catálogo",
        },
        {
          titulo: "MANIAGRO ARGENTINA",
          meta: "Aceites y oleaginosas · aceite de maní, maní blancheado y maní tostado · exporta a 48 países, entre ellos España, Italia, Suecia y Rumania",
          etiqueta: "exporta habitualmente",
        },
      ],
      cierre:
        "Las puedo filtrar por rubro, por país de destino o por las que publican sitio web. El directorio no publica datos de contacto: para eso hay que entrar a la ficha de ProCórdoba.",
    },
  },
  {
    id: "catastro",
    etiqueta: "Catastro",
    proximamente: true,
    caso: "El mapa de valores de suelo de IDECOR: publica servicios abiertos, pero todavía sin una capa estable para consultar por dirección.",
    chat: {
      pregunta: "Me ofrecen un lote en Villa Allende a USD 95.000. ¿Está caro?",
      intro: "Para los 1.200 m² de esa manzana, el valor de referencia da bastante menos:",
      items: [
        {
          titulo: "La zona está en USD 310 por m²",
          meta: "Mapa de valores de IDECOR 2026 · el lote daría cerca de USD 372.000",
          etiqueta: "USD 310/m²",
        },
        {
          titulo: "Contra lo que tiene al lado",
          meta: "Las manzanas sobre Río Ceballos están en USD 420; las del otro lado de la ruta, en USD 180",
          etiqueta: null,
        },
      ],
      cierre:
        "Es valor de suelo y no reemplaza una tasación, pero sirve para saber si el precio que te pidieron está en rango.",
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
