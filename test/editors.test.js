import { test } from "node:test";
import assert from "node:assert/strict";
import { editorOf, launchPlan } from "../mods/open-in-editor/editors.js";

test("editorOf falls back to VS Code", () => {
  assert.equal(editorOf("webstorm").title, "WebStorm");
  assert.equal(editorOf(undefined).title, "VS Code");
  assert.equal(editorOf("vim").title, "VS Code");
});

test("macOS opens the app through Launch Services first, then the CLI", () => {
  assert.deepEqual(launchPlan("webstorm", "/a b/c", "macos"), [
    ["open", ["-a", "WebStorm", "/a b/c"]],
    ["webstorm", ["/a b/c"]],
  ]);
  assert.deepEqual(launchPlan("vscode", "/x", "macos")[0], ["open", ["-a", "Visual Studio Code", "/x"]]);
});

test("Linux uses the CLI, Windows its .cmd shim first", () => {
  assert.deepEqual(launchPlan("vscode", "/x", "linux"), [["code", ["/x"]]]);
  assert.deepEqual(launchPlan("webstorm", "C:\\x", "windows")[0], ["webstorm.cmd", ["C:\\x"]]);
});

test("the file manager is Finder on macOS and Explorer on Windows", () => {
  assert.equal(editorOf("finder", "macos").title, "Finder");
  assert.equal(editorOf("finder", "windows").title, "Explorer");
  assert.equal(editorOf("webstorm", "windows").title, "WebStorm");
});

test("macOS opens the folder in Finder with open", () => {
  assert.deepEqual(launchPlan("finder", "/a b/c", "macos"), [["open", ["/a b/c"]]]);
});

test("Windows opens Explorer with backslashes and ignores its exit code", () => {
  assert.deepEqual(launchPlan("finder", "C:/Users/me/repo", "windows"), [
    ["explorer.exe", ["C:\\Users\\me\\repo"], { anyExit: true }],
  ]);
});

test("Linux has no file manager plan", () => {
  assert.deepEqual(launchPlan("finder", "/x", "linux"), []);
});
