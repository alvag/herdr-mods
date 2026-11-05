// Sends file notes to an existing agent: the payload text (payloadOf), and the
// overlay (SendDialog) where the person sees it, picks an agent of the space the
// file's tab belongs to, and presses Paste to agent. Nothing is created or
// submitted: the text lands in the agent's prompt, never followed by Enter. Only
// after that paste ran are the notes sent, and still unchanged, removed.
//
// Pasting into an agent that is waiting for an answer (a permission prompt) could
// answer it with the notes, so a blocked agent is never offered and is checked
// again right before every step that changes anything. The notes and the file are
// read again at paste time and the text reviewed must be the text pasted.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, closeOverlay, focused, notify, openOverlay, readTextFile, run, settings, setShared, shared } from "herdr";
import { pasteBlocker, pasteSteps, runSteps } from "./actions.js";
import { NOTES, isCurrent, notesOf, readNotes, removeNote } from "./notes.js";
import { button, lines } from "./notes-ui.js";

const reason = (e) => e?.message ?? String(e);
const FOCUS_TRIES = 20;

// The plain text sent for `notes` (in the order given) of `file`. The source is
// quoted data inside a fence longer than any run of backticks in it; the user's
// note stays outside the fence. Nothing here is ever run.
export function payloadOf(file, notes) {
  const name = file.view.split("/").pop(), ext = name.includes(".") ? name.split(".").pop() : "";
  const head = `File: ${file.view}${file.on ? `\nMachine: ${file.on}` : ""}`;
  const blocks = notes.map((n) => {
    const fence = "`".repeat(Math.max(3, ...(n.excerpt.match(/`+/g) ?? []).map((run) => run.length + 1)));
    const where = n.range.first === n.range.last ? `Line: ${n.range.first}` : `Lines: ${n.range.first}-${n.range.last}`;
    return `${where}\n\n${fence}${ext}\n${n.excerpt}\n${fence}\n\nNote: ${n.note}`;
  });
  return [head, ...blocks].join("\n\n");
}

// Opens the chooser for notes `ids` of `file`, tied to `space`, the space the
// viewer belongs to, so a later change of focus can't send them elsewhere.
export function openSend(file, ids, space) {
  if (!space) throw new Error("Cannot tell which space this file belongs to.");
  openOverlay({ mod: "file-actions", kind: "dialog", width: 640, height: 640, props: { sendNotes: true, file: { on: file.on ?? null, root: file.root, view: file.view }, ids: [...ids], space } });
}

// The payload for the selection as it is now, with copies of the notes it was
// built from: { payload, sent }. The file is read again and every selected note
// must still be where it was copied. Throws why not.
async function gather({ file, ids }) {
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) throw new Error("Select at least one note.");
  if (!file || typeof file.root !== "string" || typeof file.view !== "string") throw new Error("The file of these notes is not valid.");
  let text;
  try { text = await readTextFile(`${file.root}/${file.view}`, { on: file.on ?? null }); }
  catch (e) { throw new Error(`Cannot read the file: ${reason(e)}`); }
  if (typeof text !== "string") throw new Error("Cannot read the file: it is no longer available.");
  // The notes are read after the file, so an edit or a delete made meanwhile shows.
  const notes = notesOf(shared(NOTES), file).filter((n) => ids.includes(n.id));
  if (notes.length !== ids.length) throw new Error("A selected note no longer exists.");
  const moved = notes.find((n) => !isCurrent(text, n));
  if (moved) throw new Error(`The file changed: the text of ${lines(moved.range).toLowerCase()} is no longer there. Nothing was sent.`);
  return { payload: payloadOf(file, notes), sent: notes.map((n) => JSON.parse(JSON.stringify(n))) };
}

// Removes from the saved notes the `sent` ones that are still exactly as sent.
// Edited, added and already removed notes are left alone. One write, none if
// nothing matches. Throws if the saved notes can't be read or written.
function consume(sent) {
  const before = readNotes(shared(NOTES));
  let state = before;
  for (const s of sent) {
    const now = state.notes.find((n) => n.id === s.id);
    if (now && JSON.stringify(now) === JSON.stringify(s)) state = removeNote(state, s.id);
  }
  if (state !== before) setShared(NOTES, state);
}

// props: sendNotes, file, ids, space. `copy(text)` puts text on this computer's clipboard.
export class SendDialog {
  constructor(p, cx, copy) {
    this.p = p;
    this.copy = copy;
    this.payload = null;
    this.error = null;
    this.notice = null;
    this.pick = null;
    this.loading = true;
    this.sending = false;
    this.closed = false;
    cx.spawn(async (cx) => {
      try { this.payload = (await gather(p)).payload; } catch (e) { this.error = reason(e); }
      this.loading = false;
      cx.notify();
    });
  }

  // The host's close hook can arrive after the click or key that closed the overlay,
  // so Cancel and Esc mark this dialog closed themselves, at once.
  close() {
    this.closed = true;
  }

  cancel(cx) {
    this.close();
    closeOverlay(this.p.overlay);
    cx?.stop_propagation?.();
  }

  // The chosen agent as it is now, in this dialog's space only; throws why it can't take the paste.
  chosen(address) {
    const agent = agents().find((a) => a.address === address && a.space === this.p.space);
    if (!agent) throw new Error(`${address} is no longer an agent in this space.`);
    const why = pasteBlocker(agent);
    if (why) throw new Error(why);
    return agent;
  }

  paste(cx) {
    if (this.sending || !this.payload || !this.pick) return;
    const address = this.pick;
    this.sending = true;
    this.error = this.notice = null;
    this.copied = false;
    cx.notify();
    // The task's own cx is used after each await; this dialog stays open until it ends.
    cx.spawn(async (cx) => {
      try { await this.deliver(address, cx); }
      catch (e) { this.error = reason(e).replace(/\.$/, "") + "." + (this.copied ? " The notes are on the clipboard." : " Nothing was pasted."); }
      this.sending = false;
      cx.notify();
    });
  }

  async deliver(address, cx) {
    const { payload, sent } = await gather(this.p);
    if (this.closed) return;
    if (payload !== this.payload) {
      this.payload = payload;
      this.notice = "The notes changed since the preview. Review the new text, then paste again.";
      return;
    }
    let agent = this.chosen(address);
    await this.copy(payload);
    this.copied = true;
    const cancelled = () => notify({ title: "Not pasted", body: "Cancelled. The notes are on the clipboard.", level: "warning" });
    if (this.closed) return cancelled();
    agent = this.chosen(address);
    // pane.focus applies a moment later; pasting before that lands in the Files panel.
    run("pane.focus", { terminal: agent.address });
    for (let i = 0; i < FOCUS_TRIES && !this.closed && focused()?.pane !== agent.pane; i++) await new Promise((done) => cx.timer.after(50, done));
    if (this.closed) return cancelled();
    agent = this.chosen(address);
    if (focused()?.pane !== agent.pane) throw new Error(`Could not focus ${agent.address}.`);
    if (this.closed) return cancelled();
    runSteps(pasteSteps(agent.address), run);
    // The paste happened: whatever goes wrong now is a warning, never "Nothing was pasted".
    let failed = null;
    try { consume(sent); } catch (e) { failed = reason(e).replace(/\.$/, ""); }
    const where = `In the prompt of ${agent.address}. Not sent: press Enter there.`;
    if (failed) notify({ title: "Notes pasted", body: `${where} The saved notes were not removed (${failed}); delete them in the panel, do not paste again.`, level: "warning" });
    else notify({ title: "Notes pasted", body: `${where} Unchanged pasted notes were removed; edited or unsent notes were kept.`, level: "success", timeout: 3000 });
    closeOverlay(this.p.overlay);
  }

  render(t) {
    const n = Array.isArray(this.p.ids) ? this.p.ids.length : 0, list = agents().filter((a) => a.space === this.p.space);
    const label = (a) => `${a.app ?? "agent"} · ${a.address} · ${a.status}`;
    const picked = list.find((a) => a.address === this.pick);
    const ready = Boolean(this.payload && this.pick && !this.sending);
    return v_flex().id("file-actions-send").w_full().min_h(0).p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") this.cancel(cx); })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(`Send ${n} ${n === 1 ? "note" : "notes"} to an agent`))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(11.5).text_color(t.dim).child("Agents of this file's space. Pasting puts the text in the agent's prompt without pressing Enter; what is already typed there stays. It replaces what you had copied."))
      .child(v_flex().id("fa-send-agents").gap(6)
        .when(list.length === 0, (el) => el.child(div().text_size(12).text_color(t.dim).child("No agents in this space. Start one, then open Send again.")))
        .children(list.map((a) => {
          const blocked = Boolean(pasteBlocker(a)), on = a.address === this.pick;
          return h_flex().id(`fa-send-agent-${a.address}`).px(10).py(6).gap(8).items_center().rounded(7)
            .border_1().border_color(on ? t.accent : t.border).bg(t.raised)
            .when(!blocked, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click((_e, cx) => { if (!this.sending) { this.pick = a.address; cx.notify(); } }))
            .when(blocked, (el) => el.opacity(0.5).cursor_not_allowed())
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(label(a)))
            .child(div().text_size(11.5).text_color(blocked ? t.blocked : t.dim).child(blocked ? "Waiting for an answer: not available" : on ? "Selected" : a.tab_name ?? ""));
        })))
      .child(div().text_size(12).font_semibold().child(`Destination: ${picked ? label(picked) : this.pick ? `${this.pick} (not available)` : "choose an agent"}`))
      .child(div().id("fa-send-preview").flex_1().min_h(120).max_h(260).overflow_y_scroll().p(8).rounded(6).bg(t.background).border_1().border_color(t.border)
        .font_family(settings().font_family).text_size(12).text_color(t.foreground)
        .child(this.payload ?? (this.loading ? "Reading the file…" : "Nothing to send.")))
      .when(Boolean(this.notice), (el) => el.child(div().text_size(11.5).text_color(t.accent).child(this.notice)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().pt(6).gap(8).justify_end()
        .child(button(t, "fa-send-cancel", "Cancel", { action: (_e, cx) => this.cancel(cx) }))
        .child(button(t, "fa-send-paste", this.sending ? "Pasting…" : "Paste to agent", { primary: true, action: ready ? (_e, cx) => this.paste(cx) : null })));
  }
}
