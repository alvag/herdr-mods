import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTES, addNote, fileKey, isCurrent, notesOf, readNotes, removeNote, sourceOf, updateNote } from "../mods/file-actions/notes.js";

const FILE = { on: null, root: "/repo", view: "src/a.js" };
const TEXT = "alpha beta\ngamma delta\nepsilon\n";
const freeze = (v) => JSON.parse(JSON.stringify(v));

// A state with `n` notes on FILE, each copied from its own line.
function stateWith(...copies) {
  let state;
  for (const copied of copies) {
    const source = sourceOf(TEXT, copied);
    state = addNote(state, FILE, source, `note ${copied}`).state;
  }
  return state;
}

test("the notes live under their own shared key", () => {
  assert.equal(NOTES, "file-actions.notes");
});

test("sourceOf finds a unique selection in the middle of a line", () => {
  assert.deepEqual(sourceOf(TEXT, "beta"), { range: { first: 1, last: 1, column: 6 }, excerpt: "beta" });
});

test("sourceOf records a multiline selection and drops the final newline", () => {
  assert.deepEqual(sourceOf(TEXT, "beta\ngamma\n"), { range: { first: 1, last: 2, column: 6 }, excerpt: "beta\ngamma" });
});

test("sourceOf compares CRLF text with LF and stores LF", () => {
  assert.deepEqual(sourceOf("one\r\ntwo\r\nthree", "one\r\ntwo\r\n"), { range: { first: 1, last: 2, column: 0 }, excerpt: "one\ntwo" });
  assert.deepEqual(sourceOf("one\ntwo", "one\r\ntwo"), { range: { first: 1, last: 2, column: 0 }, excerpt: "one\ntwo" });
});

test("sourceOf keeps column 0 for a selection that starts the file or a line after a blank one", () => {
  assert.equal(sourceOf("\nfoo", "foo").range.column, 0);
  assert.equal(sourceOf("\nfoo", "\nfoo").range.column, 0);
  assert.deepEqual(sourceOf("\n\nfoo", "foo").range, { first: 3, last: 3, column: 0 });
});

test("sourceOf rejects empty, missing and ambiguous selections with a clear message", () => {
  assert.throws(() => sourceOf(TEXT, ""), { message: "Copy the text to annotate first." });
  assert.throws(() => sourceOf(TEXT, "\n"), { message: "Copy the text to annotate first." });
  assert.throws(() => sourceOf(TEXT, "zeta"), { message: "The copied text isn't in this file." });
  assert.throws(() => sourceOf("a b a", "a"), { message: "The copied text appears more than once in this file; select a longer, unique piece." });
  assert.throws(() => sourceOf("aaa", "aa"), { message: "The copied text appears more than once in this file; select a longer, unique piece." });
});

test("addNote stores the original file, range, excerpt and trimmed note with a new id", () => {
  const source = sourceOf(TEXT, "beta\ngamma");
  const { state, note } = addNote(undefined, { ...FILE, on: undefined }, source, "  rename this \n");
  assert.deepEqual(note, { id: "n1", file: FILE, range: source.range, excerpt: source.excerpt, note: "rename this" });
  assert.deepEqual(notesOf(state, FILE), [note]);
  assert.equal(readNotes(state).next, 2);
});

test("addNote rejects an empty note and leaves the state unchanged", () => {
  const state = stateWith("beta");
  const before = freeze(state);
  for (const text of ["", "  \n\t", undefined, 3]) {
    assert.throws(() => addNote(state, FILE, sourceOf(TEXT, "gamma"), text), { message: "Write a note first." });
  }
  assert.deepEqual(state, before);
  assert.equal(addNote(state, FILE, sourceOf(TEXT, "gamma"), "ok").note.id, "n2");
});

test("notes are isolated by machine, root and file, null and undefined machine being the same", () => {
  const other = [{ ...FILE, on: "box" }, { ...FILE, root: "/other" }, { ...FILE, view: "src/b.js" }];
  let state = stateWith("beta");
  for (const f of other) state = addNote(state, f, sourceOf(TEXT, "gamma"), "elsewhere").state;
  assert.equal(notesOf(state, FILE).length, 1);
  assert.equal(notesOf(state, { ...FILE, on: undefined }).length, 1);
  for (const f of other) assert.deepEqual(notesOf(state, f).map((n) => n.note), ["elsewhere"]);
  assert.equal(new Set([FILE, ...other].map(fileKey)).size, 4);
  assert.equal(fileKey(FILE), fileKey({ ...FILE, on: undefined }));
});

test("several notes keep their order and are never mutated by later operations", () => {
  const first = stateWith("alpha", "gamma", "epsilon");
  const snapshot = freeze(first);
  const edited = updateNote(first, "n2", " changed ");
  const removed = removeNote(edited, "n1");
  assert.deepEqual(first, snapshot);
  assert.deepEqual(notesOf(first, FILE).map((n) => n.id), ["n1", "n2", "n3"]);
  assert.deepEqual(notesOf(edited, FILE).map((n) => [n.id, n.note]), [["n1", "note alpha"], ["n2", "changed"], ["n3", "note epsilon"]]);
  assert.deepEqual(notesOf(removed, FILE).map((n) => n.id), ["n2", "n3"]);
  assert.deepEqual(notesOf(edited, FILE)[0], notesOf(first, FILE)[0]);
});

test("ids are not reused after a removal", () => {
  const state = removeNote(stateWith("alpha", "gamma"), "n2");
  assert.equal(addNote(state, FILE, sourceOf(TEXT, "epsilon"), "again").note.id, "n3");
});

test("updateNote and removeNote reject an unknown id or an empty note without changing the state", () => {
  const state = stateWith("alpha");
  const before = freeze(state);
  assert.throws(() => updateNote(state, "n9", "x"), { message: "That note no longer exists." });
  assert.throws(() => removeNote(state, "n9"), { message: "That note no longer exists." });
  assert.throws(() => updateNote(state, "n1", "  "), { message: "Write a note first." });
  assert.deepEqual(state, before);
});

test("a note is current while its exact original range still holds the excerpt", () => {
  const [note] = notesOf(stateWith("beta\ngamma"), FILE);
  assert.equal(isCurrent(TEXT, note), true);
  assert.equal(isCurrent(TEXT.replaceAll("\n", "\r\n"), note), true);
  assert.equal(isCurrent("alpha beta\ngamma delta", note), true);
});

test("a note is stale after an edit and is not re-anchored to the moved text", () => {
  const [note] = notesOf(stateWith("beta"), FILE);
  assert.equal(isCurrent("alpha BETA\ngamma delta\nepsilon\n", note), false);
  assert.equal(isCurrent("new first line\n" + TEXT, note), false, "same text one line lower");
  assert.equal(isCurrent("alpha  beta\ngamma delta\nepsilon\n", note), false, "same text one column right");
  assert.equal(isCurrent("alpha", note), false);
  assert.equal(isCurrent("", note), false);
  assert.deepEqual(notesOf(addNote(undefined, FILE, sourceOf(TEXT, "beta"), "n").state, FILE)[0].range, note.range);
});

test("readNotes accepts missing state as empty", () => {
  assert.deepEqual(readNotes(undefined), { next: 1, notes: [] });
  assert.deepEqual(readNotes(null), { next: 1, notes: [] });
  assert.deepEqual(notesOf(undefined, FILE), []);
});

test("corrupted persisted state is refused by every operation instead of being dropped", () => {
  const good = stateWith("alpha", "gamma");
  const [a, b] = good.notes;
  const cases = {
    "not an object": 5,
    "notes not a list": { next: 1, notes: {} },
    "bad counter": { ...good, next: 0 },
    "duplicate ids": { ...good, notes: [a, { ...b, id: a.id }] },
    "id at or above the counter": { ...good, next: 2 },
    "malformed id": { ...good, notes: [a, { ...b, id: "x" }] },
    "empty note": { ...good, notes: [a, { ...b, note: " " }] },
    "empty excerpt": { ...good, notes: [a, { ...b, excerpt: "" }] },
    "range does not match excerpt lines": { ...good, notes: [a, { ...b, range: { ...b.range, last: 5 } }] },
    "bad file": { ...good, notes: [a, { ...b, file: { ...b.file, root: "" } }] },
    "not a record": { ...good, notes: [a, null] },
  };
  for (const [name, bad] of Object.entries(cases)) {
    const before = freeze(bad);
    assert.throws(() => readNotes(bad), /^Error: Saved notes are invalid/, name);
    assert.throws(() => notesOf(bad, FILE), /Saved notes are invalid/, name);
    assert.throws(() => addNote(bad, FILE, sourceOf(TEXT, "beta"), "x"), /Saved notes are invalid/, name);
    assert.throws(() => updateNote(bad, "n1", "x"), /Saved notes are invalid/, name);
    assert.throws(() => removeNote(bad, "n1"), /Saved notes are invalid/, name);
    assert.deepEqual(bad, before, name);
  }
});

test("addNote refuses a malformed source", () => {
  assert.throws(() => addNote(undefined, FILE, { range: { first: 1, last: 1, column: 0 }, excerpt: "" }, "x"), /Invalid note/);
  assert.throws(() => addNote(undefined, { ...FILE, root: "" }, sourceOf(TEXT, "beta"), "x"), /Invalid note/);
});
