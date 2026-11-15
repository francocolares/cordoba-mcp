#!/usr/bin/env node
/**
 * Levanta la infraestructura inicial del proyecto, de punta a punta e idempotente:
 *
 *   1. chequea el entorno (node, pnpm, git)
 *   2. instala dependencias
 *   3. compila core + scraper
 *   4. primer scrape (si todavía no hay data/)
 *   5. compila web + worker
 *   6. crea/actualiza el Worker en Cloudflare (`wrangler deploy`)
 *   7. verifica el deploy (/health + smoke test del MCP)
 *   8. configura el repo de GitHub (secrets del deploy + label de alertas)
 *
 * Los pasos que tocan algo fuera de tu máquina (6 y 8) piden confirmación.
 *
 * Uso:
 *   pnpm bootstrap                 # interactivo
 *   pnpm bootstrap --yes           # sin preguntar (CI / reejecución)
 *   pnpm bootstrap --dry-run       # muestra qué haría, sin publicar nada
 *   pnpm bootstrap --skip-deploy   # sólo local (pasos 1-5)
 *   pnpm bootstrap --skip-github   # no toca el repo remoto
 *   pnpm bootstrap --account <id>  # fuerza la cuenta de Cloudflare destino
 *
 * La cuenta destino sale de --account, de CLOUDFLARE_ACCOUNT_ID o de preguntarte
 * cuál usar si el login tiene más de una. Nunca se elige sola cuando hay varias.
 */
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const args = new Set(argv);
const accountFlag = (() => {
  const i = argv.indexOf("--account");
  return i >= 0 ? argv[i + 1] : undefined;
})();
const flags = {
  yes: args.has("--yes") || args.has("-y"),
  dryRun: args.has("--dry-run"),
  skipDeploy: args.has("--skip-deploy"),
  skipGithub: args.has("--skip-github"),
};

const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const green = (s) => `\u001b[32m${s}\u001b[0m`;
const yellow = (s) => `\u001b[33m${s}\u001b[0m`;
const red = (s) => `\u001b[31m${s}\u001b[0m`;

let step = 0;
const TOTAL = 8;
const notes = [];

function heading(title) {
  step += 1;
  console.log(`\n${bold(`[${step}/${TOTAL}] ${title}`)}`);
}

function note(message) {
  notes.push(message);
  console.log(`  ${yellow("•")} ${message}`);
}

function ok(message) {
  console.log(`  ${green("✓")} ${message}`);
}

/** Corre un comando mostrando su salida. Devuelve { code, stdout }. */
function run(command, cmdArgs, { cwd = repoRoot, capture = false, quiet = false, env } = {}) {
  if (!quiet) console.log(`  ${dim(`$ ${command} ${cmdArgs.join(" ")}`)}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, cmdArgs, {
      cwd,
      env: { ...process.env, ...env },
      stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
    });
    let stdout = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!quiet) process.stdout.write(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout }));
  });
}

async function mustRun(command, cmdArgs, options) {
  const { code, stdout } = await run(command, cmdArgs, options);
  if (code !== 0) {
    console.error(red(`\nFalló: ${command} ${cmdArgs.join(" ")} (exit ${code})`));
    process.exit(code);
  }
  return stdout;
}

async function confirm(question) {
  if (flags.dryRun) {
    console.log(`  ${dim(`(dry-run) saltearía: ${question}`)}`);
    return false;
  }
  if (flags.yes) return true;
  if (!process.stdin.isTTY) {
    note(`sin TTY: salteo "${question}". Volvé a correrlo con --yes.`);
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`  ${bold("?")} ${question} [s/N] `)).trim().toLowerCase();
  rl.close();
  return answer === "s" || answer === "si" || answer === "sí" || answer === "y";
}

async function ask(question) {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`  ${bold("?")} ${question}: `)).trim();
  rl.close();
  return answer;
}

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

async function has(command) {
  const { code } = await new Promise((resolvePromise) => {
    const child = spawn(command, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolvePromise({ code: 1 }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1 }));
  });
  return code === 0;
}

// ─────────────────────────────────────────────────────────────── 1. entorno
heading("Chequeando el entorno");
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(red(`  Node ${process.versions.node}: hace falta >= 22 (ver .nvmrc).`));
  process.exit(1);
}
ok(`node ${process.versions.node}`);
if (!(await has("pnpm"))) {
  console.error(red("  Falta pnpm. Instalalo con `corepack enable`."));
  process.exit(1);
}
ok("pnpm disponible");
if (!(await exists(join(repoRoot, ".git"))))
  note("no estamos en un repo git: el paso 8 se saltea.");
const hasGh = await has("gh");
if (!hasGh) note("sin GitHub CLI (`gh`): el paso 8 te va a dejar instrucciones manuales.");

// ──────────────────────────────────────────────────────── 2. dependencias
heading("Instalando dependencias");
await mustRun("pnpm", ["install"]);
ok("dependencias instaladas");

// ──────────────────────────────────────────────────── 3. core + scraper
heading("Compilando core y scraper");
await mustRun("pnpm", ["--filter", "@cordoba/core", "--filter", "@cordoba/scraper", "build"]);
ok("core y scraper compilados");

// ────────────────────────────────────────────────────── 4. primer scrape
heading("Datos iniciales");
const eventsFile = join(repoRoot, "data", "events.jsonl");
if (await exists(eventsFile)) {
  const lines = (await readFile(eventsFile, "utf8")).trim().split("\n").length;
  ok(`data/events.jsonl ya existe (${lines} eventos); no lo toco`);
} else if (flags.dryRun) {
  console.log(`  ${dim("(dry-run) correría el primer scrape")}`);
} else {
  const { code } = await run("node", ["apps/scraper/dist/index.js", "run"]);
  if (code !== 0) {
    note("el primer scrape falló (¿validación o red?). Revisá la salida y reintentá.");
  } else {
    ok("primer scrape listo: data/{events,changes,status}.json*");
  }
}

// ───────────────────────────────────────────────────── 5. web + worker
heading("Compilando web y worker");
await mustRun("pnpm", ["build"]);
ok("bundle del Worker verificado (wrangler deploy --dry-run)");

// ──────────────────────────────────────────────────── 6. Cloudflare
heading("Worker en Cloudflare");
const workerDir = join(repoRoot, "apps", "worker");
let deploymentUrl = "";
if (flags.skipDeploy) {
  note("--skip-deploy: no publico nada en Cloudflare.");
} else {
  const whoami = await run("pnpm", ["exec", "wrangler", "whoami"], {
    cwd: workerDir,
    capture: true,
    quiet: true,
  });
  const email = whoami.stdout.match(/associated with the email (\S+?)\.?$/m)?.[1];
  const accounts = [...whoami.stdout.matchAll(/│\s*([^│]+?)\s*│\s*([0-9a-f]{32})\s*│/g)]
    .map((m) => ({ name: m[1], id: m[2] }))
    .filter((a) => a.name !== "Account Name");

  if (whoami.code !== 0 || accounts.length === 0) {
    note("wrangler no está autenticado o no ve ninguna cuenta. Opciones:");
    note("  a) OAuth:  pnpm --filter @cordoba/worker exec wrangler login");
    note("  b) token:  export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...");
    note("...y reejecutá `pnpm bootstrap`.");
  } else {
    if (email) ok(`autenticado como ${email}`);
    let account = null;
    const wanted = accountFlag ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    if (wanted) {
      account = accounts.find((a) => a.id === wanted) ?? {
        name: "(fuera de la lista)",
        id: wanted,
      };
      if (account.name === "(fuera de la lista)") {
        note(`la cuenta ${wanted} no aparece en este login; wrangler va a rechazar el deploy.`);
      }
    } else if (accounts.length === 1) {
      account = accounts[0];
    } else {
      console.log("  Cuentas disponibles:");
      for (const [i, a] of accounts.entries()) {
        console.log(`    ${i + 1}. ${a.name} (${a.id})`);
      }
      const pick = await ask("¿En cuál despliego? (número, enter para cancelar)");
      account = accounts[Number(pick) - 1] ?? null;
      if (!account) note("no elegiste cuenta: salteo el deploy.");
    }

    if (
      account &&
      (await confirm(
        `Publico el Worker \`cordoba-agenda\` en ${account.name} (${account.id})? Queda público en workers.dev`,
      ))
    ) {
      const out = await mustRun("pnpm", ["exec", "wrangler", "deploy"], {
        cwd: workerDir,
        capture: true,
        env: { CLOUDFLARE_ACCOUNT_ID: account.id },
      });
      const match = out.match(/https:\/\/[a-z0-9.-]*workers\.dev[^\s]*/i);
      deploymentUrl = match ? match[0].replace(/[).,]+$/, "") : "";
      ok(deploymentUrl ? `desplegado en ${deploymentUrl}` : "desplegado (no pude leer la URL)");
    } else if (account) {
      note("deploy salteado. Cuando quieras: pnpm deploy");
    }
  }
}

// ───────────────────────────────────────────────────── 7. verificación
heading("Verificando el deploy");
if (!deploymentUrl) {
  note("sin URL de deploy: salteo la verificación.");
} else {
  try {
    const health = await fetch(`${deploymentUrl}/health`, { signal: AbortSignal.timeout(20_000) });
    const body = await health.json();
    ok(`/health -> ${health.status}, ${body.events} eventos, validación ${body.validation}`);
  } catch (err) {
    note(`no pude leer /health: ${err.message}`);
  }
  const smoke = await run("node", ["apps/worker/smoke.mjs", `${deploymentUrl}/mcp`]);
  if (smoke.code === 0) ok("el MCP remoto responde a las 6 tools");
  else note("el smoke test del MCP falló; mirá la salida de arriba.");
}

// ─────────────────────────────────────────────────────── 8. GitHub
heading("Repo de GitHub");
if (flags.skipGithub || !(await exists(join(repoRoot, ".git")))) {
  note("paso salteado.");
} else if (!hasGh) {
  console.log(
    [
      "  Configurá a mano (Settings → Secrets and variables → Actions):",
      "    CLOUDFLARE_API_TOKEN   token con permiso Workers Scripts:Edit",
      "    CLOUDFLARE_ACCOUNT_ID  el account id de tu cuenta de Cloudflare",
      "  Y creá la label `scraper-alert` para las alertas del validador.",
    ].join("\n"),
  );
} else {
  const authed = (await run("gh", ["auth", "status"], { capture: true, quiet: true })).code === 0;
  if (!authed) {
    note("`gh` no está autenticado: corré `gh auth login` y reejecutá.");
  } else if (await confirm("Configuro los secrets y la label en el repo remoto?")) {
    for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
      const value = process.env[name] ?? (await ask(`Valor de ${name} (enter para saltear)`));
      if (!value) {
        note(`${name} sin valor: configuralo después con \`gh secret set ${name}\`.`);
        continue;
      }
      const { code } = await run("gh", ["secret", "set", name, "--body", value]);
      if (code === 0) ok(`${name} configurado`);
    }
    await run("gh", [
      "label",
      "create",
      "scraper-alert",
      "--color",
      "B60205",
      "--description",
      "La fuente de la agenda cambió",
      "--force",
    ]);
    ok("label `scraper-alert` lista");
  } else {
    note("no toqué el repo remoto.");
  }
}

// ─────────────────────────────────────────────────────────── resumen
console.log(`\n${bold("Listo.")}`);
if (deploymentUrl) {
  console.log(`  Web:         ${deploymentUrl}`);
  console.log(`  MCP remoto:  ${deploymentUrl}/mcp`);
  console.log(`  Conectarlo:  claude mcp add --transport http agenda-cordoba ${deploymentUrl}/mcp`);
}
console.log("  MCP local:   ya configurado en .mcp.json (requiere `pnpm build`)");
console.log("  Scrapeo:     node apps/scraper/dist/index.js run");
console.log("  Automático:  Actions `scrape-agenda` (diaria) y `deploy-cloudflare`");
if (notes.length > 0) {
  console.log(`\n${bold("Pendientes:")}`);
  for (const message of notes) console.log(`  ${yellow("•")} ${message}`);
}
