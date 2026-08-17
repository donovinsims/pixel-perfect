import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const fixture = await readFile(join(root, "tests", "fixture.html"), "utf8");
const server = createServer((request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  let body = fixture;
  if (requestUrl.searchParams.has("drift")) body = body.replace("border-radius:14px", "border-radius:2px").replace("height:48px", "height:36px");
  if (requestUrl.searchParams.has("textdrift")) body = body.replace("Measured CTA card", "Changed measured CTA card");
  response.setHeader("Content-Type", "text/html");
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const url = `http://127.0.0.1:${server.address().port}`;
const out = join(root, ".tmp-fixture");
const run = (file, values) => new Promise((resolve, reject) => {
  const processHandle = spawn(process.execPath, [join(root, "scripts", file), ...values], { stdio: "inherit" });
  processHandle.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${file}: ${code}`)));
});

try {
  await run("capture-source.mjs", ["--url", url, "--out", out]);
  await run("capture-states.mjs", ["--url", url, "--out", out]);
  const source = JSON.parse(await readFile(join(out, "evidence", "observation-desktop.json")));
  assert.ok(source.sections.length > 0);
  assert.ok(source.sections[0].before.backgroundImage.includes("radial-gradient"));
  assert.equal(source.sections[0].style.borderRadius, "14px");
  assert.ok(source.interactive.some((item) => item.style.borderRadius === "11px"));

  const missingClone = join(out, "missing-clone");
  await mkdir(missingClone, { recursive: true });
  await run("visual-diff.mjs", ["--source", join(out, "source", "screenshots"), "--clone", missingClone, "--out", join(out, "missing-diffs")]);
  const missingReport = JSON.parse(await readFile(join(out, "missing-diffs", "visual-report.json")));
  assert.ok(missingReport.results.every((result) => result.missing && result.changeRatio === 1));

  await run("compare-geometry.mjs", ["--source", out, "--clone-url", `${url}?textdrift=1`, "--out", join(out, "text-drift-geometry.json")]);
  const textDrift = JSON.parse(await readFile(join(out, "text-drift-geometry.json")));
  assert.ok(textDrift.results.some((result) => result.comparisons.some((comparison) => comparison.matchedBy === "index" && comparison.status === "review")));

  await run("verify-clone.mjs", ["--source", out, "--clone-url", `${url}?drift=1`]);
  const drift = JSON.parse(await readFile(join(out, "verification", "fidelity-report.json")));
  assert.notEqual(drift.machineGate, "pass");

  await run("verify-clone.mjs", ["--source", out, "--clone-url", url]);
  const corrected = JSON.parse(await readFile(join(out, "verification", "fidelity-report.json")));
  assert.equal(corrected.machineGate, "pass");
  console.log("fixture capture, safe states, failure handling, geometry confidence, and regression passed");
} finally {
  server.close();
  await rm(out, { recursive: true, force: true });
}
