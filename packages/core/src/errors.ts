/**
 * Forma única de error de toda la API de datos. El handler la traduce a
 * `{ error: { code, message, hint, valid_values } }` con `isError: true`.
 *
 * `code` es estable y para el modelo; `message` es para el usuario; `hint` es lo
 * operativo; `valid_values` convierte un error en discovery (el modelo se
 * corrige sin tener que llamar a `list_collections`).
 */

export type ErrorCode =
  | "unknown_collection"
  | "unknown_filter"
  | "invalid_filter_value"
  | "invalid_date"
  | "invalid_cursor"
  | "invalid_id"
  | "source_unavailable"
  | "not_found"
  | "unsupported";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  hint?: string;
  valid_values?: unknown[];
}

export class DataError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly valid_values: unknown[] | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { hint?: string; valid_values?: unknown[] } = {},
  ) {
    super(message);
    this.name = "DataError";
    this.code = code;
    this.hint = options.hint;
    this.valid_values = options.valid_values;
  }

  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint === undefined ? {} : { hint: this.hint }),
      ...(this.valid_values === undefined ? {} : { valid_values: this.valid_values }),
    };
  }
}

export function isDataError(value: unknown): value is DataError {
  return value instanceof DataError;
}
