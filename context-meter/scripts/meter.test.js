// Run: node scripts/meter.test.js
const assert = require("node:assert");
const { lastTurn, coldCache, compactSummary, changedFiles } = require("./meter.js");

const line = (o) => JSON.stringify(o);
const at = "2026-01-01T10:00:00.000Z";
const assistant = (input, create, read, cache_creation, isSidechain = false) =>
  line({
    type: "assistant",
    isSidechain,
    timestamp: at,
    message: {
      usage: { input_tokens: input, cache_creation_input_tokens: create, cache_read_input_tokens: read, output_tokens: 999, cache_creation },
    },
  });
const oneHour = { ephemeral_1h_input_tokens: 2000, ephemeral_5m_input_tokens: 0 };
const readOnly = { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 };
const transcript = [
  assistant(1, 2000, 40000, oneHour),
  "not json",
  assistant(2, 0, 100171, readOnly), // read the cache only: TTL comes from the call before
  assistant(5, 0, 5000, oneHour, true), // subagent: ignored
  line({ type: "user", message: { content: "hi" } }),
].join("\n");

const turn = lastTurn(transcript);
assert.deepStrictEqual(turn, { used: 100173, at: Date.parse(at), ttl: 3600 }); // output excluded
assert.strictEqual(lastTurn(line({ type: "user" })), null);
assert.strictEqual(lastTurn(`${transcript}\n${line({ type: "system", subtype: "compact_boundary" })}`), null);

const min = 60000;
const MIN_TOKENS = 100000;
assert.strictEqual(coldCache(turn, turn.at + 59 * min, MIN_TOKENS), null); // cache still warm
assert.deepStrictEqual(coldCache(turn, turn.at + 75 * min, MIN_TOKENS), { idleMin: 75, ttlMin: 60, tokens: 100173, writePrice: 2 });
assert.strictEqual(coldCache(turn, turn.at + 75 * min, 200000), null); // below the setting
assert.strictEqual(coldCache({ ...turn, ttl: null }, turn.at + 75 * min, MIN_TOKENS), null); // TTL unknown
assert.strictEqual(coldCache(null, turn.at + 75 * min, MIN_TOKENS), null); // no turn yet
assert.strictEqual(coldCache({ ...turn, ttl: 300 }, turn.at + 6 * min, MIN_TOKENS).writePrice, 1.25);

// The frame the engine puts around a summary, as it writes it.
const summaryRow = (body) =>
  line({
    type: "user",
    isCompactSummary: true,
    message: {
      content:
        "This session is being continued from a previous conversation.\n\n<system-reminder>x</system-reminder>\n" +
        `Summary:\n${body}\n\nIf you need specific details from before compaction, read the full transcript at: a.jsonl\n` +
        "Continue the conversation from where it left off without asking the user any further questions.",
    },
  });
assert.strictEqual(compactSummary(`${summaryRow("1. Old")}\n${summaryRow("1. Step two\n2. Files")}`), "1. Step two\n2. Files");
assert.strictEqual(compactSummary(transcript), null); // never compacted

const toolUse = (name, input, isSidechain = false) =>
  line({ type: "assistant", isSidechain, message: { content: [{ type: "tool_use", name, input }] } });
assert.deepStrictEqual(
  changedFiles(
    [
      toolUse("Edit", { file_path: "src/a.ts" }),
      toolUse("Bash", { command: "ls" }),
      toolUse("Write", { file_path: "src/b.ts" }),
      toolUse("Edit", { file_path: "src/a.ts" }), // listed once
      toolUse("NotebookEdit", { notebook_path: "n.ipynb" }),
      toolUse("Write", { file_path: "src/agent.ts" }, true), // a subagent's: not the session's
      line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
    ].join("\n"),
  ),
  ["src/a.ts", "src/b.ts", "n.ipynb"],
);

console.log("ok");
