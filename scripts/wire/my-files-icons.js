// Binds the icon matcher to file-icons' table. Copied into my-files next to
// my-files-icon-match.js and file-icons-table.js (file-icons' own icons.js); the
// table isn't in this repo, so only my-files imports this file.
import ICONS from "./file-icons-table.js";
import { iconFor } from "./my-files-icon-match.js";

export const icon = (path, dir, open, dark) => iconFor(ICONS, path, dir, open, dark);
