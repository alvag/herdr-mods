// Pure helpers: which editor, and the programs that open a folder in it.

export const EDITORS = {
  vscode: { title: "VS Code", app: "Visual Studio Code", cli: "code" },
  webstorm: { title: "WebStorm", app: "WebStorm", cli: "webstorm" },
};

// The editor for an id, falling back to VS Code for a missing or unknown one.
export function editorOf(id) {
  return EDITORS[id] ?? EDITORS.vscode;
}

// The commands to try in order, each [program, args]; the first that exits 0 wins.
// macOS goes through Launch Services, so it works without the CLI on PATH.
export function launchPlan(id, folder, platform) {
  const e = editorOf(id);
  if (platform === "macos") return [["open", ["-a", e.app, folder]], [e.cli, [folder]]];
  if (platform === "windows") return [[`${e.cli}.cmd`, [folder]], [e.cli, [folder]]];
  return [[e.cli, [folder]]];
}
