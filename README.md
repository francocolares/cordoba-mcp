# Córdoba MCP

**Los datos abiertos de Córdoba, al alcance de tu agente.**

Una fuente de datos unificada y estandarizada para potenciar la riqueza de los datos públicos de
Córdoba con la vanguardia en inteligencia artificial.

Los datos están publicados, pero cada organismo los publica a su manera: una planilla de Google acá,
un `.xls` que circula por Drive allá, un WordPress, un KML, un PDF. Este proyecto los normaliza a un
modelo común y los expone en **<https://cordobamcp.com/mcp>** para que Claude, ChatGPT o cualquier
cliente que hable MCP pueda consultarlos y cruzarlos en lenguaje natural.

El acceso es **público, gratuito y de solo lectura**, y el código es abierto.

## Conectarlo

No se instala nada: es un servidor MCP remoto, se conecta por URL.

```
https://cordobamcp.com/mcp
```

```bash
# Claude Code
claude mcp add --transport http cordoba-mcp https://cordobamcp.com/mcp
```

En **Claude web** se da de alta una sola vez en
[Personalizar → Conectores](https://claude.ai/customize/connectors) (_Agregar → Agregar conector
personalizado_) y queda disponible en web, escritorio y celular. No hay que iniciar sesión ni cargar
claves: el servidor es público.

Guía oficial de Anthropic para conectores personalizados:
<https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp>

Después se le pregunta en castellano, sin saber nada de la API: _"¿qué hay para hacer este fin de
semana en Córdoba?"_, _"¿qué farmacia está de turno ahora cerca de Nueva Córdoba?"_.

## Qué datos hay hoy

| Colección         | Qué trae                                                  | Fuente                                              |
| ----------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `eventos`         | Agenda de eventos de la ciudad, con fecha, lugar y precio | Municipalidad de Córdoba                            |
| `farmacias_turno` | Las 851 farmacias con su turno, barrio y coordenadas      | Colegio de Farmacéuticos de la Provincia de Córdoba |

El catálogo está pensado para crecer: observación de la Tierra, incendios, producción
agropecuaria, actividad económica, catastro, colectivos, cultura, trámites, Boletín Oficial,
espacios verdes. El listado completo de lo que viene está en
**<https://cordobamcp.com>**, y el orden lo define la demanda real: qué consultas se hacen y cuáles
fallan por falta de datos.

## El approach

Cinco decisiones explican casi todo el proyecto:

- **La colección es el eje, no el organismo.** Una colección es un tipo de registro (`eventos`,
  `farmacias_turno`) y puede alimentarse de varias fuentes a la vez; de qué organismo viene cada
  dato es un filtro opcional. El agente no tiene que saber quién publica qué.
- **La superficie es chica y está congelada.** Cuatro tools —`list_collections`, `search`, `get`,
  `source_status`— cubren todo el catálogo. Sumar una fuente o una colección es agregar _datos_, no
  tools: nadie tiene que reconectar nada para ver datos nuevos, y el modelo descubre lo que hay
  llamando a `list_collections`.
- **Cada respuesta declara de dónde salió y de cuándo es.** Fuente, licencia, `data_as_of`, zona
  horaria y los supuestos del dominio viajan en cada respuesta. Donde el dato original es ambiguo,
  se dice (el turnero del Colegio, por ejemplo, no publica de qué hora a qué hora corre la guardia:
  la ventana asumida viaja marcada como no confirmada).
- **Validar antes de escribir.** Cada fuente tiene un validador que corre primero y detecta que el
  origen cambió de forma. Si falla, no se persiste nada y se abre un issue: es preferible un dato de
  hace un rato a dar de baja 851 farmacias por un archivo mal exportado.
- **Los datos se actualizan sin desplegar código.** Los scrapes corren por cron, publican el
  dataset normalizado y el servidor lo lee de ahí. El deploy es sólo para código.

Detalle técnico: **[docs/api.md](docs/api.md)** (las cuatro tools y las convenciones de la API),
**[docs/operacion.md](docs/operacion.md)** (cómo se corre, se actualiza y se despliega) y
**[docs/analitica.md](docs/analitica.md)** (cómo se mide el impacto, sin cookies ni rastreo).

## Cómo contribuir

### Ser sponsor del proyecto

Mantener cada fuente tiene un costo: relevamiento, validación y las correcciones que exige cada
cambio en el origen, más la infraestructura que sostiene el servidor. El aporte de los sponsors
cubre ese trabajo y es lo que permite sostener el compromiso de fondo: **código abierto y acceso
gratuito**.

- El proyecto se mantiene de código abierto y el acceso a los datos, gratuito
- Prioridad para solicitar nuevas fuentes en el roadmap
- Mención del sponsor en el repositorio y en la página

→ **[Quiero ser sponsor](https://wa.me/543546436319?text=%C2%A1Hola%20Franco!%20Te%20escribo%20desde%20la%20web%20de%20C%C3%B3rdoba%20MCP.%20Quiero%20ser%20sponsor%20del%20proyecto.)**

### Estandarizar los datos de tu empresa

El mismo trabajo que este proyecto hace con los datos públicos puede aplicarse dentro de una
organización: consolidar lo que hoy está disperso en planillas, bases, documentos y sistemas
heredados, normalizarlo a un modelo común y dejarlo disponible para que la inteligencia artificial
lo consulte y lo cruce.

- Relevamiento y normalización de las fuentes a un modelo común
- Un servidor MCP privado, con el control de accesos de la organización
- Integración con Claude, ChatGPT o las aplicaciones que el equipo ya usa

→ **[Agendar una cita](https://cal.com/franco-colares/mcp-kickoff)** · [Conocer Zifos](https://zifos.dev/)

### Sumar datos o código

- **Pedir una fuente nueva o reportar un dato mal normalizado:**
  [abrí un issue](https://github.com/francocolares/cordoba-mcp/issues).
- **Implementarla:** una fuente nueva es una implementación de `Source` más un descriptor de
  colección; el mapa está en [docs/api.md](docs/api.md) y el detalle operativo en
  [docs/operacion.md](docs/operacion.md).
- **Charlar:** [grupo de WhatsApp de la comunidad](https://chat.whatsapp.com/GvyIE2o8rCI6dYL2M2dJNV)
  · <hola@fecocode.com>

## Licencia y atribución

El **código** va bajo [MIT](LICENSE).

Los **datos** no son propios: son datos públicos de terceros, normalizados por este proyecto. El
crédito es de quien los publica, y cada registro y cada respuesta del MCP declaran su fuente y su
fecha.

| Fuente                                              | Dataset                    |
| --------------------------------------------------- | -------------------------- |
| Municipalidad de Córdoba – Agenda Turística         | `eventos`                  |
| Colegio de Farmacéuticos de la Provincia de Córdoba | `farmacias_turno`          |
| Georef (datos.gob.ar) y Nominatim / OpenStreetMap   | coordenadas geocodificadas |

Si reusás los datos, mantené la atribución a la fuente original (las coordenadas de OSM se
redistribuyen bajo ODbL). Este proyecto no tiene relación oficial con ninguno de esos organismos y
los datos se ofrecen **sin garantía**: para decisiones que importan, verificá en la fuente.

---

Hecho en Córdoba por [Zifos](https://zifos.dev/).
