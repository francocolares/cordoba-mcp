import { GVIZ_URL, SOURCE_ID, SOURCE_NAME } from "../config.js";
import { columns, fetchGviz, rows, unwrap } from "../gviz.js";
import { normalizeRows } from "../normalize.js";
import type { Source, SourceFetch } from "./base.js";

export class TurismoMuniSource implements Source {
  readonly id = SOURCE_ID;
  readonly name = SOURCE_NAME;

  constructor(private readonly url: string = GVIZ_URL) {}

  async fetch(now: string): Promise<SourceFetch> {
    const text = await fetchGviz(this.url);
    return this.fromText(text, now);
  }

  fromText(text: string, now: string): SourceFetch {
    const payload = unwrap(text);
    const { events, warnings } = normalizeRows(rows(payload), now);
    return { events, raw: payload, columns: columns(payload), warnings };
  }
}
