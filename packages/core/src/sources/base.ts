import type { Event } from "../models.js";

export interface SourceFetch {
  /** Eventos normalizados de este run. */
  events: Event[];
  /** Payload crudo (ya desenvuelto) para guardar como snapshot. */
  raw: unknown;
  /** Columnas detectadas, para el hash de esquema. */
  columns: string[];
  warnings: string[];
}

export interface Source {
  readonly id: string;
  readonly name: string;
  fetch(now: string): Promise<SourceFetch>;
}
