// Pure model of the file notes: a note ties a user's text to a piece of a file
// (where it was copied from) and stays until the user removes it. No UI and no
// writes here: every operation takes the stored state, validates it, and
// returns the new one for the caller to keep with setShared(NOTES, state).
//
// State: { next, notes }, `next` being the number of the next id ("n<next>")
// and `notes` the records in the order they were added:
//   { id, file: { on, root, view }, range: { first, last, column }, excerpt, note }
// `file` is the machine (null here), the panel's root and the path relative to
// it; notes belong to that file, not to a tab. `range` is where `excerpt` was
// when copied: 1-based lines `first`..`last` and `column`, the 0-based offset in
// the first line where the text starts. `excerpt` has LF line endings, the way
// contextOf reads copied text.
//
// Stored state that doesn't validate throws instead of being read as empty or
// filtered, so a caller can never overwrite notes it couldn't understand.
// Every error is a message fit for the person using the panel.

export const NOTES = "file-actions.notes";

const nl = (s) => s.replace(/\r\n/g, "\n");
const text = (v) => typeof v === "string" && v.trim() !== "";
const count = (v, min) => Number.isInteger(v) && v >= min;

// The identity of a file for grouping notes: machine + root + relative path.
export function fileKey(file) {
  return JSON.stringify([file.on ?? null, file.root, file.view]);
}

// Why a record can't be kept, or null.
function problemWith(r, next) {
  if (!r || typeof r !== "object") return "it isn't a record";
  const m = /^n(\d+)$/.exec(r.id);
  if (!m || (next && Number(m[1]) >= next)) return "its id is not valid";
  const f = r.file, g = r.range;
  if (!f || typeof f !== "object" || !text(f.root) || !text(f.view) || !(f.on === null || text(f.on))) return "its file is not valid";
  if (typeof r.excerpt !== "string" || r.excerpt === "" || r.excerpt.includes("\r")) return "its copied text is not valid";
  if (!g || !count(g.first, 1) || !count(g.column, 0) || g.last !== g.first + r.excerpt.split("\n").length - 1) return "its line range does not match its copied text";
  if (!text(r.note)) return "its note is empty";
  return null;
}

// The stored state, checked; missing state is no notes yet.
export function readNotes(stored) {
  if (stored === undefined || stored === null) return { next: 1, notes: [] };
  const bad = (why) => new Error(`Saved notes are invalid: ${why}.`);
  if (typeof stored !== "object" || !count(stored.next, 1) || !Array.isArray(stored.notes)) throw bad("unexpected format");
  const seen = new Set();
  stored.notes.forEach((r, i) => {
    const why = problemWith(r, stored.next);
    if (why) throw bad(`note ${i + 1}, ${why}`);
    if (seen.has(r.id)) throw bad(`note ${i + 1} repeats the id ${r.id}`);
    seen.add(r.id);
  });
  return stored;
}

// Where copied text sits in the file: { range, excerpt }. It must be there
// exactly once (even overlapping itself), because the first of several places
// would be a guess.
export function sourceOf(fileText, copied) {
  const body = nl(copied).replace(/\n$/, "");
  if (!body) throw new Error("Copy the text to annotate first.");
  const all = nl(fileText), at = all.indexOf(body);
  if (at < 0) throw new Error("The copied text isn't in this file.");
  if (all.indexOf(body, at + 1) >= 0) throw new Error("The copied text appears more than once in this file; select a longer, unique piece.");
  const first = all.slice(0, at).split("\n").length;
  const column = at - (at ? all.lastIndexOf("\n", at - 1) + 1 : 0);
  return { range: { first, last: first + body.split("\n").length - 1, column }, excerpt: body };
}

// Adds a note for `source` (from sourceOf) in `file`: { state, note }.
export function addNote(stored, file, source, noteText) {
  const { next, notes } = readNotes(stored);
  if (!text(noteText)) throw new Error("Write a note first.");
  const note = { id: `n${next}`, file: { on: file.on ?? null, root: file.root, view: file.view }, range: { ...source.range }, excerpt: source.excerpt, note: noteText.trim() };
  const why = problemWith(note);
  if (why) throw new Error(`Invalid note: ${why}.`);
  return { state: { next: next + 1, notes: [...notes, note] }, note };
}

function existing(notes, id) {
  if (!notes.some((n) => n.id === id)) throw new Error("That note no longer exists.");
}

// The state with the text of note `id` replaced.
export function updateNote(stored, id, noteText) {
  const state = readNotes(stored);
  existing(state.notes, id);
  if (!text(noteText)) throw new Error("Write a note first.");
  return { ...state, notes: state.notes.map((n) => (n.id === id ? { ...n, note: noteText.trim() } : n)) };
}

// The state without note `id`. Its id is not given to a later note.
export function removeNote(stored, id) {
  const state = readNotes(stored);
  existing(state.notes, id);
  return { ...state, notes: state.notes.filter((n) => n.id !== id) };
}

// The notes of one file, in the order they were added.
export function notesOf(stored, file) {
  const key = fileKey(file);
  return readNotes(stored).notes.filter((n) => fileKey(n.file) === key);
}

// Whether the file still has the note's excerpt at exactly the range it was
// copied from. When it doesn't, the note is stale: it is never moved to where
// the text went.
export function isCurrent(fileText, note) {
  const lines = nl(fileText).split("\n"), { first, column } = note.range;
  if (first > lines.length || column > lines[first - 1].length) return false;
  const from = lines.slice(0, first - 1).reduce((n, l) => n + l.length + 1, 0) + column;
  return nl(fileText).startsWith(note.excerpt, from);
}
