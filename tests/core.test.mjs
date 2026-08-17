import test from "node:test"; import assert from "node:assert/strict"; import { parseArgs, safeName } from "../lib/core.mjs";
test("parseArgs preserves positionals and flags", () => assert.deepEqual(parseArgs(["capture-source", "--url", "https://example.com", "--flag"]), { _: ["capture-source"], url: "https://example.com", flag: true }));
test("safeName makes portable artifact names", () => assert.equal(safeName("Hero / CTA!"), "Hero-CTA"));
