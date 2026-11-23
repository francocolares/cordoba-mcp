import { EXPORTADORES_BASE } from "./config.js";

const TAGS = /<[^>]+>/g;
const SCRIPTS = /<(script|style)\b[\s\S]*?<\/\1>/gi;
const WHITESPACE = /\s+/g;
const NON_BREAKING_SPACE = /\u00a0/g;

export function stripScripts(html: string): string {
  return html.replace(SCRIPTS, "");
}

export function clean(fragment: string | undefined): string | undefined {
  if (fragment === undefined) return undefined;
  const text = decodeEntities(fragment.replace(TAGS, " "))
    .replace(NON_BREAKING_SPACE, " ")
    .replace(WHITESPACE, " ")
    .trim();
  return text === "" ? undefined : text;
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&aacute;", "á")
    .replaceAll("&eacute;", "é")
    .replaceAll("&iacute;", "í")
    .replaceAll("&oacute;", "ó")
    .replaceAll("&uacute;", "ú")
    .replaceAll("&ntilde;", "ñ")
    .replaceAll("&Ntilde;", "Ñ")
    .replaceAll("&amp;", "&");
}

export function first(pattern: RegExp, text: string): string | undefined {
  const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(text);
  return match?.[1];
}

export function all(pattern: RegExp, text: string): RegExpMatchArray[] {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  return [...text.matchAll(global)];
}

export function balancedDiv(html: string, opening: string): string | undefined {
  const start = html.indexOf(opening);
  if (start === -1) return undefined;
  const rest = html.slice(start + opening.length);
  let depth = 1;
  for (const match of rest.matchAll(/<div\b|<\/div>/g)) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return rest.slice(0, match.index);
  }
  return rest;
}

export function absolute(path: string | undefined): string | undefined {
  if (path === undefined || path === "") return undefined;
  return path.startsWith("http") ? path : `${EXPORTADORES_BASE}/${path.replace(/^\/+/, "")}`;
}
