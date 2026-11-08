import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MODS_DIR = "mods";
const FORBIDDEN = ["setTimeout(", "setInterval(", "clearTimeout(", "clearInterval("];

async function* jsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Tests do not run in the Herdr runtime, so they are allowed to use
      // Node's global timer APIs. Only scan the code that ships to the app.
      if (entry.name === "test" || entry.name === "tests") continue;
      yield* jsFiles(path);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      yield path;
    }
  }
}

async function findOffenders(dir) {
  const offenders = [];
  for await (const path of jsFiles(dir)) {
    const content = await readFile(path, "utf8");
    for (const token of FORBIDDEN) {
      if (content.includes(token)) {
        offenders.push({ path, token });
        break;
      }
    }
  }
  return offenders;
}

test("mods must not use global timer APIs", async () => {
  const offenders = await findOffenders(MODS_DIR);
  assert.deepEqual(
    offenders,
    [],
    `global timer APIs found in mods: ${JSON.stringify(offenders, null, 2)}`,
  );
});

test("scanner excludes test directories and still flags runtime files", async () => {
  const root = await mkdtemp(join(tmpdir(), "mods-runtime-rules-"));
  try {
    // Runtime code with a forbidden API must still be reported.
    await mkdir(join(root, "runtime-mod", "lib"), { recursive: true });
    await writeFile(
      join(root, "runtime-mod", "lib", "util.js"),
      "setTimeout(() => {}, 0);",
    );

    // Test files are allowed to use timers; they are not shipped to the mod.
    await mkdir(join(root, "test-mod", "test"), { recursive: true });
    await mkdir(join(root, "tests-mod", "tests"), { recursive: true });
    await writeFile(
      join(root, "test-mod", "test", "util.test.js"),
      "setTimeout(() => {}, 0);",
    );
    await writeFile(
      join(root, "tests-mod", "tests", "util.test.js"),
      "setInterval(() => {}, 0);",
    );

    const offenders = await findOffenders(root);
    assert.deepEqual(offenders, [
      { path: join(root, "runtime-mod", "lib", "util.js"), token: "setTimeout(" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
