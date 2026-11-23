import { addDays, resolveDateInput, toIso, weekendRange } from "./datetime.js";
import type { Category, Event } from "./models.js";
import { normalizeKey, truncate } from "./text.js";

export const SUMMARY_DESCRIPTION_MAX = 300;

export interface EventSummary {
  id: string;
  title: string;
  category: string;
  start: string;
  end: string | null;
  all_day: boolean;
  venue: string | null;
  price_type: string;
  ticket_url: string | null;
  description: string | null;
}

export function toSummary(event: Event): EventSummary {
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    start: event.start,
    end: event.end,
    all_day: event.all_day,
    venue: event.venue,
    price_type: event.price_type,
    ticket_url: event.ticket_url,
    description: truncate(event.description, SUMMARY_DESCRIPTION_MAX),
  };
}

export interface SearchParams {
  query?: string;
  category?: string;
  date_from?: string;
  date_to?: string;
  free_only?: boolean;
  include_past?: boolean;
  include_inactive?: boolean;
  limit?: number;
}

const byStart = (a: Event, b: Event) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

/** Un evento "ocupa" hasta su `end` (o hasta el fin de su día si no tiene). */
export function endsAt(event: Event): string {
  return event.end ?? `${event.start.slice(0, 10)}T23:59:00${event.start.slice(-6)}`;
}

export function matchesText(event: Event, query: string): boolean {
  const needle = normalizeKey(query);
  if (needle === "") return true;
  const hay = normalizeKey(
    [event.title, event.description, event.venue, event.organizer, event.category_raw]
      .filter(Boolean)
      .join(" "),
  );
  return needle.split(" ").every((token) => hay.includes(token));
}

export function searchEvents(
  events: Event[],
  params: SearchParams = {},
  now: Date = new Date(),
): Event[] {
  const limit = params.limit ?? 20;
  const from = params.date_from ? resolveDateInput(params.date_from, now) : null;
  const to = params.date_to ? resolveDateInput(params.date_to, now) : null;
  const fromIso = from ? toIso(from, { hour: 0, minute: 0 }) : null;
  const toIsoBound = to ? toIso(addDays(to, 1), { hour: 0, minute: 0 }) : null;
  const category = params.category ? normalizeKey(params.category) : null;

  return events
    .filter((e) => (params.include_inactive ? true : e.active))
    .filter((e) => (params.free_only ? e.price_type === "gratis" : true))
    .filter((e) => (category ? e.category === category : true))
    .filter((e) => (params.query ? matchesText(e, params.query) : true))
    .filter((e) => (params.include_past ? true : Date.parse(endsAt(e)) >= now.getTime()))
    .filter((e) => (fromIso ? endsAt(e) >= fromIso : true))
    .filter((e) => (toIsoBound ? e.start < toIsoBound : true))
    .sort(byStart)
    .slice(0, Math.max(0, limit));
}

/** Eventos que caen en un día (incluye los de rango que lo abarcan). */
export function eventsOn(events: Event[], date: string, now: Date = new Date()): Event[] {
  const day = resolveDateInput(date, now);
  if (!day) return [];
  const start = toIso(day, { hour: 0, minute: 0 });
  const end = toIso(addDays(day, 1), { hour: 0, minute: 0 });
  return events.filter((e) => e.active && e.start < end && endsAt(e) >= start).sort(byStart);
}

export function thisWeekend(
  events: Event[],
  opts: { free_only?: boolean; category?: string } = {},
  now: Date = new Date(),
): { range: { from: string; to: string }; events: Event[] } {
  const range = weekendRange(now);
  const category = opts.category ? normalizeKey(opts.category) : null;
  const found = events
    .filter((e) => e.active && e.start <= range.to && endsAt(e) >= range.from)
    .filter((e) => (opts.free_only ? e.price_type === "gratis" : true))
    .filter((e) => (category ? e.category === category : true))
    .sort(byStart);
  return { range, events: found };
}

export function listCategories(events: Event[]): { category: Category; count: number }[] {
  const counts = new Map<Category, number>();
  for (const e of events) {
    if (!e.active) continue;
    counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

export function getEvent(events: Event[], id: string): Event | null {
  return events.find((e) => e.id === id) ?? null;
}
