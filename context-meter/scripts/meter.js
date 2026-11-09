// The transcript readers for hooks/cold-cache.ts, in Node because the hooks module reads
// no file over 4 MiB. Each fails loudly; the module surfaces the error.
//   cold <transcript> <min tokens> — JSON `{ idleMin, ttlMin, tokens, writePrice }` when the
//                                    next request would write a big context to a cold cache,
//                                    else nothing.
//   handoff <transcript>           — JSON `{ summary, files }` for a new session's first prompt.
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

// The newest compaction's summary, without the engine's frame around it: the frame tells
// the model to go on without asking, which a new session must not read.
function compactSummary(transcript) {
  const row = transcript.split("\n").findLast((line) => line.includes('"isCompactSummary":true'));
  if (!row) return null;
  const { content } = JSON.parse(row).message;
  const text = typeof content === "string" ? content : content[0].text;
  return text
    .replace(/^[\s\S]*?\nSummary:\n/, "")
    .replace(/\n+If you need specific details[\s\S]*$/, "")
    .trim();
}

// The files the main loop's Edit, Write and NotebookEdit calls named, oldest first. What a
// shell command changed is not here: the new session's `git status` shows it.
function changedFiles(transcript) {
  const files = new Set();
  for (const line of transcript.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    const e = JSON.parse(line);
    if (e.type !== "assistant" || e.isSidechain) continue;
    for (const block of e.message.content) {
      if (block.type !== "tool_use" || !["Edit", "Write", "NotebookEdit"].includes(block.name)) continue;
      files.add(block.input.file_path ?? block.input.notebook_path);
    }
  }
  return [...files];
}

if (require.main === module) {
  const [command, transcriptPath, minTokens] = process.argv.slice(2);
  const transcript = fs.readFileSync(transcriptPath, "utf8");
  if (command === "cold") {
    const cold = coldCache(lastTurn(transcript), Date.now(), Number(minTokens));
    process.stdout.write(cold ? JSON.stringify(cold) : "");
  } else if (command === "handoff") {
    process.stdout.write(JSON.stringify({ summary: compactSummary(transcript), files: changedFiles(transcript) }));
  } else {
    throw new Error(`unknown command "${command}", expected cold or handoff`);
  }
}

module.exports = { lastTurn, coldCache, compactSummary, changedFiles };
