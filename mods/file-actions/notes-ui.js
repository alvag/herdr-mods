// The file notes on screen: the panel beside a file tab (NotesPanel) and the
// dialog that adds or edits one note (NoteDialog). The notes themselves, and
// every rule about them, are in notes.js; this only shows them and, on a click,
// reads the stored state at that moment, changes it with notes.js and saves it
// with setShared(NOTES, state), so it never keeps an older copy.
//
// Text from the file and from the user is drawn as plain text, never as markdown.
import { div } from "gpui-kit";
import { v_flex, h_flex, Checkbox, Textarea, TextareaState } from "gpui-base";
import { closeOverlay, notify, openOverlay, readTextFile, setShared, settings, shared } from "herdr";
import { NOTES, addNote, isCurrent, notesOf, readNotes, removeNote, sourceOf, updateNote } from "./notes.js";

const PANEL_WIDTH = 320;
const PANEL_MIN = 240;

export const lines = (range) => (range.first === range.last ? `Line ${range.first}` : `Lines ${range.first}-${range.last}`);
const reason = (e) => e?.message ?? String(e);

// The same look as the other dialogs' buttons; a disabled one has no handler.
export function button(t, id, text, { primary, action }) {
  return h_flex().id(id).h(30).px(12).items_center().rounded(8)
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium()
    .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(action))
    .when(!action, (el) => el.opacity(0.45).cursor_not_allowed())
    .child(text);
}

// The text copied from the file, as a box of plain text.
function excerptBox(t, excerpt) {
  return div().p(8).rounded(6).bg(t.background).border_1().border_color(t.border).max_h(110).overflow_hidden()
    .font_family(settings().font_family).text_size(12).text_color(t.foreground).child(excerpt);
}

// Starts adding a note for the text just copied from `fileText`: finds it (it
// throws why not, with a message for the user) and opens the dialog. Nothing is
// stored until Save.
export function startNote(file, fileText, copied) {
  const { range, excerpt } = sourceOf(fileText, copied);
  openOverlay({ mod: "file-actions", kind: "dialog", width: 560, height: 440, props: { note: "add", file, range, excerpt } });
}

// The notes of the file shown in a tab, one card each. `picked` is which cards
// are ticked for a later send; it lives in this view only, not in shared state.
export class NotesPanel {
  constructor() {
    this.reset();
  }

  // A different file is shown: nothing of the other one stays ticked or asked about.
  reset() {
    this.picked = new Set();
    this.asking = null;
  }

  // What to show for `file`: { list } or, when the stored notes can't be read, { error }.
  state(file) {
    try { return { list: notesOf(shared(NOTES), file) }; } catch (e) { return { error: reason(e) }; }
  }

  // The ticked notes of `file`, in the order they were added. Throws when the stored notes are invalid.
  selected(file) {
    return notesOf(shared(NOTES), file).filter((n) => this.picked.has(n.id));
  }

  // `add` is the click handler, or null while Add note can't work.
  addButton(t, state, add) {
    return button(t, "fa-note-add", "Add note", { primary: true, action: state.error ? null : add });
  }

  remove(id, cx) {
    try {
      setShared(NOTES, removeNote(shared(NOTES), id));
      this.picked.delete(id);
    } catch (e) { notify({ title: "Could not delete the note", body: reason(e), level: "error" }); }
    this.asking = null;
    cx.notify();
  }

  // `send(ids)` starts sending those notes, or is null while sending isn't possible.
  panel(t, state, fileText, keys, send = null) {
    const ids = (state.list ?? []).filter((n) => this.picked.has(n.id)).map((n) => n.id), count = ids.length;
    return v_flex().id("fa-notes").w(PANEL_WIDTH).min_w(PANEL_MIN).h_full().min_h(0).flex_none().border_l(1).border_color(t.border)
      .child(h_flex().h(34).flex_none().px(12).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().child(`Notes${state.list ? ` (${state.list.length})` : ""}`))
        .when(count > 0, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(`${count} selected`)))
        .when(count > 0, (el) => el.child(div().w(8)).child(button(t, "fa-notes-send-selected", "Send selected", { action: send ? () => send(ids) : null }))))
      .child(v_flex().id("fa-notes-list").flex_1().min_h(0).overflow_y_scroll().p(10).gap(10)
        .when(Boolean(state.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(state.error)))
        .when(state.list?.length === 0, (el) => el.child(div().text_size(12).text_color(t.dim)
          .child(`Select text, press ${keys}, then Add note.`)))
        .children((state.list ?? []).map((n) => this.card(t, n, fileText, send))));
  }

  card(t, n, fileText, send = null) {
    const stale = typeof fileText === "string" && !isCurrent(fileText, n);
    return v_flex().id(`fa-note-${n.id}`).p(10).gap(8).rounded(8).border_1().border_color(stale ? t.blocked : t.border).bg(t.raised)
      .child(h_flex().items_center().gap(8)
        .child(Checkbox.new(`fa-note-pick-${n.id}`).checked(this.picked.has(n.id)).cursor_pointer()
          .on_change((on, cx) => { if (on) this.picked.add(n.id); else this.picked.delete(n.id); cx.notify(); })
          .child(h_flex().items_center().gap(6)
            .child(div().size(14).rounded(3).border_1().border_color(t.input).text_size(11).text_color(t.accent).child(this.picked.has(n.id) ? "✓" : ""))
            .child(div().text_size(11.5).text_color(t.dim).child("Select"))))
        .child(div().flex_1())
        .child(div().text_size(11.5).text_color(t.dim).child(lines(n.range))))
      .child(excerptBox(t, n.excerpt))
      .when(stale, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child("The file changed: this text is no longer at these lines.")))
      .child(div().text_size(12.5).text_color(t.foreground).child(n.note))
      .child(this.asking === n.id
        ? h_flex().items_center().gap(8)
          .child(div().flex_1().text_size(12).text_color(t.blocked).child("Delete this note?"))
          .child(button(t, `fa-note-keep-${n.id}`, "Keep", { action: (_e, cx) => { this.asking = null; cx.notify(); } }))
          .child(button(t, `fa-note-confirm-${n.id}`, "Delete", { primary: true, action: (_e, cx) => this.remove(n.id, cx) }))
        : h_flex().gap(8).justify_end()
          .child(button(t, `fa-note-send-${n.id}`, "Send", { action: send ? () => send([n.id]) : null }))
          .child(button(t, `fa-note-edit-${n.id}`, "Edit", {
            action: () => openOverlay({ mod: "file-actions", kind: "dialog", width: 560, height: 440, props: { note: "edit", id: n.id } }),
          }))
          .child(button(t, `fa-note-delete-${n.id}`, "Delete", { action: (_e, cx) => { this.asking = n.id; cx.notify(); } })));
  }
}

// Adds a note (props: file, range, excerpt) or edits the text of one (props: id).
// The source is never changed here: an edit keeps the original range.
export class NoteDialog {
  constructor(p, cx) {
    this.p = p;
    this.error = null;
    this.busy = false;
    this.closed = false;
    let value = "";
    try {
      if (p.note === "edit") {
        const found = readNotes(shared(NOTES)).notes.find((n) => n.id === p.id);
        if (!found) throw new Error("That note no longer exists.");
        this.about = found;
        value = found.note;
      } else this.about = { file: p.file, range: p.range, excerpt: p.excerpt };
    } catch (e) {
      this.about = null;
      this.error = reason(e);
    }
    this.area = TextareaState.new({ placeholder: "Write your note…", value, rows: 5 });
    this.area.focus();
    cx.timer.after(600, () => { if (!this.closed) this.area.focus(); });
  }

  // Cancel and Esc mark the dialog closed at once, before Herdr calls close(), so
  // a Save still waiting for the file can't store anything afterwards.
  dismiss() {
    if (this.closed) return;
    this.closed = true;
    closeOverlay(this.p.overlay);
  }

  // Herdr's cleanup; it may come after dismiss(), so it only releases once.
  close() {
    if (this.released) return;
    this.closed = this.released = true;
    this.area.release();
  }

  // Keeps the dialog open with the reason when the change can't be made.
  commit(change, cx) {
    if (this.closed) return;
    try {
      setShared(NOTES, change());
      this.dismiss();
    } catch (e) {
      this.error = reason(e);
      cx.notify();
    }
  }

  save(cx) {
    if (this.busy || !this.about) return;
    const value = this.area.value(), { file, range, excerpt } = this.about;
    if (this.p.note === "edit") return this.commit(() => updateNote(shared(NOTES), this.p.id, value), cx);
    // The file may have changed since the text was copied: read it again, and
    // store the note only where the text still is. The task's own cx is used after the await.
    this.busy = true;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        let text;
        try { text = await readTextFile(`${file.root}/${file.view}`, { on: file.on ?? null }); }
        catch (e) { throw new Error(`Cannot read the file: ${reason(e)}`); }
        if (this.closed) return;
        if (typeof text !== "string" || !isCurrent(text, { range, excerpt })) {
          throw new Error("The file changed since the text was copied. Close this and copy it again.");
        }
        this.commit(() => addNote(shared(NOTES), file, { range, excerpt }, value).state, cx);
      } catch (e) {
        if (this.closed) return;
        this.error = reason(e);
        cx.notify();
      } finally { this.busy = false; }
    });
  }

  render(t) {
    const edit = this.p.note === "edit", a = this.about;
    return v_flex().id("file-actions-note").w_full().min_h(0).p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.dismiss(); cx.stop_propagation(); } })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(edit ? "Edit note" : "Add note"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .when(Boolean(a), (el) => el
        .child(div().text_size(11.5).text_color(t.dim).truncate().child(`${a.file.view} · ${lines(a.range)}`))
        .child(excerptBox(t, a.excerpt)))
      .child(Textarea.new(this.area).h(120).px(10).py(8).rounded(9).border_1().border_color(this.error ? t.blocked : t.accent)
        .bg(t.background).text_size(12.8).text_color(t.foreground))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().pt(6).gap(8).justify_end()
        .child(button(t, "fa-note-cancel", "Cancel", { action: () => this.dismiss() }))
        .child(button(t, "fa-note-save", "Save", { primary: true, action: a ? (_e, cx) => this.save(cx) : null })));
  }
}
