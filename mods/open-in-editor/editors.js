// Pure helpers: which editor, and the programs that open a folder in it.

export const EDITORS = {
  vscode: { title: "VS Code", app: "Visual Studio Code", cli: "code" },
  webstorm: { title: "WebStorm", app: "WebStorm", cli: "webstorm" },
  finder: { title: "Finder", windowsTitle: "Explorer" },
};

// The editor for an id, falling back to VS Code for a missing or unknown one.
export function editorOf(id, platform) {
  const e = EDITORS[id] ?? EDITORS.vscode;
  return platform === "windows" && e.windowsTitle ? { ...e, title: e.windowsTitle } : e;
}

// The commands to try in order, each [program, args, options?]; the first that
// exits 0 wins, or that exits at all with { anyExit: true }.
// macOS goes through Launch Services, so it works without the CLI on PATH.
export function launchPlan(id, folder, platform) {
  if (id === "finder") {
    if (platform === "macos") return [["open", [folder]]];
    // Explorer exits 1 even when it opens, and misreads forward slashes.
    if (platform === "windows") return [["explorer.exe", [folder.replaceAll("/", "\\")], { anyExit: true }]];
    return [];
  }
  const e = editorOf(id);
  if (platform === "macos") return [["open", ["-a", e.app, folder]], [e.cli, [folder]]];
  if (platform === "windows") return [[`${e.cli}.cmd`, [folder]], [e.cli, [folder]]];
  return [[e.cli, [folder]]];
}
