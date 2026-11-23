const CORPORATE_FORMS: ReadonlySet<string> = new Set([
  "SA",
  "SAS",
  "SRL",
  "SCA",
  "SCS",
  "SENC",
  "SH",
  "SE",
  "UTE",
  "LTDA",
  "SOCIEDAD",
  "SOC",
  "COOPERATIVA",
  "COOP",
  "MUTUAL",
  "FUNDACION",
  "ASOCIACION",
  "ASOC",
  "CAMARA",
  "CENTRO",
  "INSTITUTO",
  "UNIVERSIDAD",
  "MUNICIPALIDAD",
  "CONSEJO",
  "COLEGIO",
  "CLUSTER",
  "CONSORCIO",
  "AGENCIA",
  "HNOS",
  "HERMANOS",
  "CIA",
  "COMPANIA",
  "ASOCIADOS",
  "HIJOS",
  "GRUPO",
  "INC",
  "LLC",
  "CORP",
  "BV",
  "GMBH",
  "SPA",
  "LIMITED",
]);

const MAX_WORDS_IN_A_PERSON_NAME = 5;

export function isNaturalPerson(legalName: string | undefined | null): boolean | undefined {
  if (legalName === undefined || legalName === null || legalName.trim() === "") return undefined;

  const normalized = legalName
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll(".", " ")
    .replaceAll(",", " ");

  const tokens = joinInitials(normalized.split(/\s+/).filter((token) => token !== ""));

  if (tokens.some((token) => CORPORATE_FORMS.has(token))) return false;
  if (/\d/.test(normalized)) return false;
  return tokens.length >= 2 && tokens.length <= MAX_WORDS_IN_A_PERSON_NAME;
}

function joinInitials(tokens: readonly string[]): string[] {
  const result: string[] = [];
  let initials = "";
  for (const token of tokens) {
    if (token.length === 1) {
      initials += token;
      continue;
    }
    if (initials !== "") {
      result.push(initials);
      initials = "";
    }
    result.push(token);
  }
  if (initials !== "") result.push(initials);
  return result;
}
