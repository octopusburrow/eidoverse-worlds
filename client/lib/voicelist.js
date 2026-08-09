// voicelist — THE VOICES YOU HAVE, AS A LIST.
//
// R, 2026-08-09: "the add-remove buttons aren't very intuitive... I feel like
// the current implementation is clunky. Is there another UI you're aware of that
// would be more suitable?"
//
// She was right, and the reason is a rule worth keeping: a DROPDOWN is for
// choosing among options someone else fixed. The moment the options are ones the
// user adds and removes, the list wants to be visible — because "what do I have?"
// and "get rid of that one" both become questions the UI has to answer without
// being opened first. macOS System Settings, VS Code, OBS all use a visible list
// with per-row affordances for exactly this.
//
// The buttons were clunky for a specific, diagnosable reason: a "−" beside a
// dropdown acts on *whatever is currently selected*, so you must select a thing
// in order to destroy it, and the button cannot say which thing it means. Here
// the × lives ON the row, so the target is never ambiguous and there is nothing
// to explain.
//
// The other half of the clunk: the old dropdown mixed NOUNS ("en_US-amy-low")
// with VERBS ("voice file on this computer…") and STATUS ("loading voices…") in
// one list of supposed choices. Verbs are rows here too, but visibly separate
// and at the bottom, where an "add" affordance belongs.

const ROW = `
.vl { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.vl-row { display: flex; align-items: center; gap: 6px; padding: 2px 4px;
  border-radius: 3px; cursor: pointer; }
.vl-row:hover { background: #2a2a2a; }
.vl-row .vl-x { opacity: 0; margin-left: auto; padding: 0 4px; border: 0;
  background: none; color: inherit; cursor: pointer; font-size: 13px; line-height: 1; }
/* The × appears on hover OR on keyboard focus — hover-only affordances are
   invisible to anyone navigating by keyboard, and this one is destructive, so
   it must be reachable without a mouse. */
.vl-row:hover .vl-x, .vl-row .vl-x:focus { opacity: .75; }
.vl-row .vl-x:hover { opacity: 1; color: #f88; }
.vl-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vl-add { opacity: .6; }
.vl-add:hover { opacity: 1; }
.vl-dim { opacity: .45; font-style: italic; }
`;

function ensureCss() {
  if (document.getElementById('vl-css')) return;
  const st = document.createElement('style');
  st.id = 'vl-css';
  st.textContent = ROW;
  document.head.appendChild(st);
}

/** Build the list.
 *  items:    [{id, name, note}]   — the voices this person has
 *  selected: id | null
 *  on:       {select(id), remove(id), addFile(), addEndpoint()}
 */
export function renderVoiceList(host, { items, selected, on, busy }) {
  ensureCss();
  host.className = 'vl';
  host.textContent = '';

  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'vl-row';
    row.tabIndex = 0;
    row.title = it.note || it.name;

    const mark = document.createElement('span');
    // ● / ○ rather than a checkmark: it reads as "this one is live" at a glance
    // and needs no colour, which matters on a panel that must survive VR.
    mark.textContent = it.id === selected ? '●' : '○';
    mark.style.opacity = it.id === selected ? '1' : '.4';

    const name = document.createElement('span');
    name.className = 'vl-name' + (it.dim ? ' vl-dim' : '');
    name.textContent = it.name;

    const x = document.createElement('button');
    x.className = 'vl-x';
    x.textContent = '×';
    x.title = `forget ${it.name}`;
    x.setAttribute('aria-label', `forget ${it.name}`);
    // stopPropagation, or clicking × also selects the row it is destroying.
    x.onclick = (e) => { e.stopPropagation(); on.remove?.(it.id); };

    row.append(mark, name, x);
    row.onclick = () => on.select?.(it.id);
    row.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on.select?.(it.id); }
      // Delete/Backspace on a focused row is the list convention everywhere
      // else; without it the × is mouse-only in practice.
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); on.remove?.(it.id); }
    };
    host.appendChild(row);
  }

  // THE VERBS, visibly below the nouns. When the list is empty these are the
  // whole UI, which is the correct empty state: the only thing you can do is
  // add one, so that is the only thing showing.
  const add = document.createElement('div');
  add.className = 'vl-row vl-add';
  add.tabIndex = 0;
  // SAY WHAT THE CONTROL WANTS, in the words of the thing it wants (R,
  // 2026-08-09: "I might label it text-to-speech model or something like that
  // just to make what this option is looking for most explicit"). "voice file"
  // could be a .wav; "text-to-speech model" can only be the thing it is. The two
  // rows deliberately do NOT share a noun — a .onnx is a model, an endpoint is a
  // running service, and calling both "voice" is what made the old field ask for
  // a file and get an address (R, 2026-08-08: "it looks like some kind of ip
  // string instead of a file path...?").
  add.textContent = busy ? `+ ${busy}` : '+ add a text-to-speech model…';
  add.title = 'a Piper .onnx model and its matching .onnx.json, from this computer';
  if (!busy) {
    add.onclick = () => on.addFile?.();
    add.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on.addFile?.(); } };
  }
  host.appendChild(add);

  const ep = document.createElement('div');
  ep.className = 'vl-row vl-add';
  ep.tabIndex = 0;
  ep.textContent = '+ add a speech server…';
  ep.title = 'the address of a text-to-speech server you are already running (ws:// or http://)';
  ep.onclick = () => on.addEndpoint?.();
  ep.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); on.addEndpoint?.(); } };
  host.appendChild(ep);

  return host;
}
