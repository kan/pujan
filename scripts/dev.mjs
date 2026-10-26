// Starts the kan-game.app ID platform (kan/game's wrangler dev), the backend
// (wrangler dev) and the frontend (vite) together, as vegtab's and TAKO-SEN's scripts/dev.mjs
// do. The Workers take free ports and vite proxies /api to the
// backend, so another project's wrangler dev cannot collide. The backend
// reaches the ID platform through wrangler's dev registry, which links the `ID`
// service binding to the running kan/game Worker. Under `roji run`, vite
// listens on the port roji chose and both Workers accept the URL roji assigned
// as an origin.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** `count` distinct free ports: all are held until every one is chosen. */
async function freePorts(count) {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise((resolve, reject) => {
          const server = createServer();
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
  );
  const ports = servers.map((server) => String(server.address().port));
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
  return ports;
}

/** One variable of a .dev.vars file, unquoted. */
function devVar(file, name) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match?.[1] !== name) continue;
    const value = match[2].trim();
    return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return undefined;
}

// kan/game beside this repository, unless KAN_GAME_DIR says otherwise.
const gameDir = resolve(process.env.KAN_GAME_DIR ?? resolve(root, "../game"));
const gameVars = resolve(gameDir, ".dev.vars");
const publicKeys = existsSync(gameVars)
  ? devVar(gameVars, "ID_PUBLIC_KEYS")
  : undefined;
if (!publicKeys) {
  console.error(
    `kan/game is needed at ${gameDir} with its local key: run \`npm install\`, \`npm run generate-key -- --dev-vars\` and \`npx wrangler d1 migrations apply DB --local\` there (see its README), or set KAN_GAME_DIR.`,
  );
  process.exit(1);
}

// wrangler dev needs the assets directory to exist; the SPA itself comes from vite.
mkdirSync(resolve(root, "frontend/dist"), { recursive: true });

// Two wrangler dev processes: each needs its own devtools port too.
const [apiPort, gamePort, apiInspector, gameInspector] = await freePorts(4);
const rojiUrl = process.env.ROJI_URL;
const screenPort = (rojiUrl && process.env.PORT) || "5173";
const screenUrl = rojiUrl
  ? new URL(rojiUrl).origin
  : `http://localhost:${screenPort}`;
const screenOrigins = [
  ...new Set([screenUrl, `http://localhost:${screenPort}`]),
].join(",");
const portal = `http://localhost:${gamePort}`;

// npm puts .cmd shims on the PATH on Windows; those need a shell.
const shell = process.platform === "win32";
// The shell joins the arguments with spaces, and the program then splits them
// by the Windows rules, which drop bare double quotes. Quote an argument that
// has some, as the JSON of the keys does.
const shellArg = (arg) =>
  shell && arg.includes('"') ? `"${arg.replaceAll('"', '\\"')}"` : arg;

// The backend checks the ID cookie with kan/game's local public key, and
// accepts the screen's origin. These override backend/wrangler.jsonc, so the
// backend needs no .dev.vars.
// Both Workers listen on 127.0.0.1, where freePorts found the ports free and
// vite's proxy connects.
const apiArgs = [
  "dev",
  "--ip",
  "127.0.0.1",
  "--port",
  apiPort,
  "--inspector-port",
  apiInspector,
  "--var",
  shellArg(`ID_PUBLIC_KEYS:${publicKeys}`),
  "--var",
  `ALLOWED_ORIGINS:${screenOrigins}`,
  "--var",
  `FRONTEND_URL:${screenUrl}`,
];

// The ID platform takes requests from the screen (through the backend) and
// serves its own portal pages.
const gameArgs = [
  "dev",
  "--ip",
  "127.0.0.1",
  "--port",
  gamePort,
  "--inspector-port",
  gameInspector,
  "--var",
  `ALLOWED_ORIGINS:${screenOrigins}`,
  "--var",
  `PORTAL_ORIGIN:${portal}`,
];

console.log(
  `pujan: ${screenUrl}  (backend http://localhost:${apiPort}, ID platform ${portal})`,
);

/**
 * A package's own command, run directly (not through npx): stopping the child
 * then stops the server itself, which stops its workerd.
 */
const bin = (dir, name) =>
  resolve(dir, "node_modules/.bin", shell ? `${name}.cmd` : name);

const children = [
  spawn(bin(gameDir, "wrangler"), gameArgs, {
    cwd: gameDir,
    stdio: ["ignore", "inherit", "inherit"],
    shell,
  }),
  // Only one process may read the keyboard: two readers would split the key
  // presses, so it is this repository's backend.
  spawn(bin(root, "wrangler"), apiArgs, {
    cwd: resolve(root, "backend"),
    stdio: "inherit",
    shell,
  }),
  // A moved port would be an origin the Workers reject, so fail instead.
  spawn(bin(root, "vite"), ["--port", screenPort, "--strictPort"], {
    cwd: resolve(root, "frontend"),
    stdio: ["ignore", "inherit", "inherit"],
    shell,
    env: {
      ...process.env,
      PUJAN_API_PORT: apiPort,
      VITE_KAN_GAME_PORTAL: portal,
    },
  }),
];

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  // A server that ignores SIGTERM must not keep its port.
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 5000).unref();
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  // No server alone is a working app.
  child.once("exit", (code) => stop(code ?? 1));
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop(0));
