// The transcript reader for hooks/cold-cache.ts, in Node because the hooks module reads
// no file over 4 MiB. It fails loudly; the module surfaces the error.
//   cold <session id> <min tokens> — JSON `{ transcriptPath, cold }`, `cold` being
//                                    `{ idleMin, ttlMin, tokens, writePrice }` when the next
//                                    request would write a big context to a cold cache, else null.
//   path <session id>              — the session's transcript path.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The session's transcript, found by its id: a hooks worker the engine replaced keeps no
// path, and the id is the one thing the session always knows.
function transcriptOf(sessionId, configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")) {
  if (!/^[\w-]+$/.test(sessionId)) throw new Error(`not a session id: "${sessionId}"`);
  const projects = path.join(configDir, "projects");
  const found = fs
    .readdirSync(projects)
    .map((dir) => path.join(projects, dir, `${sessionId}.jsonl`))
    .filter((file) => fs.existsSync(file));
  if (found.length !== 1) throw new Error(`expected one transcript of session ${sessionId} in ${projects}, found ${found.length}`);
  return found[0];
}

// Cache write price as a multiple of base input, by TTL in seconds; a cache read is 0.1.
const WRITE_PRICE = { 300: 1.25, 3600: 2 };

// The last main-thread API call: context size, when it ended, and the TTL of the cache
// it wrote. null when there is none, or when a compaction came after it.
function lastTurn(transcript) {
  const lines = transcript.trimEnd().split("\n");
  let turn = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!turn && e.type === "system" && e.subtype === "compact_boundary") return null;
    const u = e.type === "assistant" && !e.isSidechain && e.message?.usage;
    if (!u) continue;
    // Same input-only sum the VS Code extension and the status line use.
    turn ??= {
      used: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      at: Date.parse(e.timestamp),
      ttl: null,
    };
    // A call that only read the cache does not say its TTL; an earlier one that wrote does.
    const c = u.cache_creation;
    turn.ttl = c?.ephemeral_1h_input_tokens ? 3600 : c?.ephemeral_5m_input_tokens ? 300 : null;
    if (turn.ttl) return turn;
  }
  return turn;
}

// What the question before the next request reports, when that request would write a big
// context to a cache that expired.
function coldCache(turn, now, minTokens) {
  if (!turn?.ttl || turn.used < minTokens || now - turn.at <= turn.ttl * 1000) return null;
  return {
    idleMin: Math.round((now - turn.at) / 60000),
    ttlMin: turn.ttl / 60,
    tokens: turn.used,
    writePrice: WRITE_PRICE[turn.ttl],
  };
}

if (require.main === module) {
  const [command, sessionId, minTokens] = process.argv.slice(2);
  const transcriptPath = transcriptOf(sessionId);
  if (command === "path") process.stdout.write(transcriptPath);
  else if (command === "cold") {
    const cold = coldCache(lastTurn(fs.readFileSync(transcriptPath, "utf8")), Date.now(), Number(minTokens));
    process.stdout.write(JSON.stringify({ transcriptPath, cold }));
  } else throw new Error(`unknown command "${command}", expected cold or path`);
}

module.exports = { lastTurn, coldCache, transcriptOf };
