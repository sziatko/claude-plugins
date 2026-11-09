// The transcript reader for hooks/cold-cache.ts, in Node because the hooks module reads
// no file over 4 MiB. It fails loudly; the module surfaces the error.
//   cold <transcript> <min tokens> — JSON `{ idleMin, ttlMin, tokens, writePrice }` when the
//                                    next request would write a big context to a cold cache,
//                                    else nothing.
const fs = require("node:fs");

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
  const [command, transcriptPath, minTokens] = process.argv.slice(2);
  if (command !== "cold") throw new Error(`unknown command "${command}", expected cold`);
  const cold = coldCache(lastTurn(fs.readFileSync(transcriptPath, "utf8")), Date.now(), Number(minTokens));
  process.stdout.write(cold ? JSON.stringify(cold) : "");
}

module.exports = { lastTurn, coldCache };
