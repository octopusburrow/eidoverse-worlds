// editundo — undo as inverse speech. (Slice 6a of the design doc.)
//
// There is no shadow editor state to roll back: every edit was a verb in the
// log, so undo is SPEAKING THE INVERSE VERB — a comp edit's inverse is the
// comp with its previous data (null if it was just added); a place's inverse
// is the previous place. The log keeps both sentences, history stays append-
// only and honest (an undone mistake happened and un-happened, visibly), and
// multiplayer needs no special case: your undo is just your next utterance.
// Redo = undo of an undo, same machinery, no extra concept.
//
// Scope, deliberately: undoes YOUR edits from THIS session's panels (the
// capture hook lives in the channel-box commit path). It is not a general
// time machine over other people's work — that's the checkpoints/history
// surface (design doc §4.1), a different tool for a different power.

import { sendVerb } from './net.js';
import { flashHint } from './ui.js';

const stack = [];          // {verb, args} inverses, newest last
const redo = [];
const MAX = 100;

/** Register an edit: its inverse sentence + the sentence itself (for redo). */
export function recordPair(inverse, counter) {
  stack.push({ ...inverse, counter: { ...counter } });
  if (stack.length > MAX) stack.shift();
  redo.length = 0;
}

// Some inverses need more than one sentence: putting back a deleted thing is
// a spawn AND its transform AND every component it was wearing. A verb may
// therefore carry `also: [{verb, args}, ...]`, spoken in order after it.
// Single-verb pairs are untouched — `also` is simply absent.
const speakAll = (step) => {
  sendVerb(step.verb, step.args);
  for (const extra of step.also ?? []) sendVerb(extra.verb, extra.args);
};

export function undo() {
  const inv = stack.pop();
  if (!inv) { flashHint('nothing to undo'); return; }
  if (inv.counter) redo.push({ verb: inv.counter.verb, args: inv.counter.args, also: inv.counter.also, counter: { verb: inv.verb, args: inv.args, also: inv.also } });
  speakAll(inv);
  flashHint(`undo: ${inv.verb}${inv.args.type ? ' ' + inv.args.type : ''} on ${inv.args.id}`);
}

export function redoLast() {
  const r = redo.pop();
  if (!r) { flashHint('nothing to redo'); return; }
  stack.push({ verb: r.counter.verb, args: r.counter.args, also: r.counter.also, counter: { verb: r.verb, args: r.args, also: r.also } });
  speakAll(r);
  flashHint(`redo: ${r.verb}${r.args.type ? ' ' + r.args.type : ''} on ${r.args.id}`);
}

export const undoDebug = () => ({ undo: stack.length, redo: redo.length });

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;   // field-local undo is the browser's
  e.preventDefault();
  if (e.shiftKey) redoLast(); else undo();
});
