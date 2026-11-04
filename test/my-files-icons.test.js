import { test } from "node:test";
import assert from "node:assert/strict";
import { iconFor } from "../scripts/wire/my-files-icon-match.js";

const T = {
  file: "file", folder: "folder",
  fileNames: { "package.json": "nodejs", "readme.md": "readme", ".github/workflows/ci.yml": "ci", "x.ts": "named-x" },
  fileExtensions: { ts: "typescript", "spec.ts": "test-ts", md: "markdown", json: "json" },
  folderNames: { tests: "folder-test", vscode: "folder-vscode", ".github/workflows": "folder-ci", src: "folder-src" },
  light: { fileNames: { "readme.md": "readme_light" }, fileExtensions: {}, folderNames: { src: "folder-src_light" } },
};
const I = (id) => `mods/file-icons/icons/${id}.svg`;
const f = (path, dark = true) => iconFor(T, path, false, false, dark);
const d = (path, open = false, dark = true) => iconFor(T, path, true, open, dark);

test("file: exact name, extension, unknown fallback", () => {
  assert.equal(f("package.json"), I("nodejs"));
  assert.equal(f("a/b/main.ts"), I("typescript"));
  assert.equal(f("notes.xyz"), I("file"));
  assert.equal(f("Makefile"), I("file"));
});

test("file: longest extension wins, name beats extension, case-insensitive", () => {
  assert.equal(f("a/foo.spec.ts"), I("test-ts"));
  assert.equal(f("x.ts"), I("named-x"));
  assert.equal(f("README.MD"), I("readme"));
  assert.equal(f("Foo.TS"), I("typescript"));
});

test("file: a path rule beats name and extension", () => {
  assert.equal(f(".github/workflows/ci.yml"), I("ci"));
  assert.equal(f("repo/.github/workflows/ci.yml"), I("ci"));
});

test("folder: name, bare name, fallback", () => {
  assert.equal(d("src/__tests__"), I("folder-test"));
  assert.equal(d(".vscode"), I("folder-vscode"));
  assert.equal(d("lib/Tests"), I("folder-test"));
  assert.equal(d("other"), I("folder"));
  assert.equal(d(".github/workflows"), I("folder-ci"));
});

test("folder: open uses <id>-open, light uses <base>-open_light", () => {
  assert.equal(d("tests", true), I("folder-test-open"));
  assert.equal(d("other", true), I("folder-open"));
  assert.equal(d("src", true, false), I("folder-src-open_light"));
  assert.equal(d("src", false, false), I("folder-src_light"));
});

test("light overrides only when not dark", () => {
  assert.equal(f("readme.md", false), I("readme_light"));
  assert.equal(f("readme.md", true), I("readme"));
  assert.equal(f("a.json", false), I("json"));
});

test("a table without light or a section falls back instead of throwing", () => {
  const bare = { file: "file", folder: "folder", fileExtensions: { ts: "typescript" } };
  assert.equal(iconFor(bare, "a/b.ts", false, false, false), I("typescript"));
  assert.equal(iconFor(bare, "readme.md", false, false, false), I("file"));
  assert.equal(iconFor(bare, "src", true, true, false), I("folder-open"));
});
