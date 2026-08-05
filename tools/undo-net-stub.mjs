// undo-test substitutes this for net.js — records the sentences spoken.
export const spoken = [];
export function sendVerb(verb, args) { spoken.push({ verb, args }); }
