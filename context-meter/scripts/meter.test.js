// Run: node scripts/meter.test.js
const assert = require("node:assert");
const { lastTurn, coldCache } = require("./meter.js");

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

console.log("ok");
