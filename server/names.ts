// names — what a display name may hold at the door.
//
// A display name travels everywhere: every nameplate, chat line, hint, roster and agent transcript. The client's
// readers are fixed to treat it as text (client/lib/markup.js), and this is the second wall: a name may not carry the
// characters that open a tag or close an attribute — < > and " — so no reader, ours or anyone's (an agent's page, a
// bot, a future panel), ever has to be careful with one.
//
// & and ' stay allowed: they're in real names (Tom & Jerry, O'Brien) and escape cleanly wherever they're shown.
//
// A name TYPED at this door is refused with a plain explanation, so the person picks another. A name the identity
// service gave (a verified session's display name, which may legitimately hold anything) is not the person's choice
// here, so it is not refused — those characters are dropped instead and they come in.
const MARKUP = /[<>"]/g;

export function nameAtDoor(name: string, { typed }: { typed: boolean }): { name: string; refused?: string } {
  if (!/[<>"]/.test(name)) return { name };
  if (!typed) return { name: name.replace(MARKUP, "").trim() };
  return { name, refused: `that name has < > or " in it — those can't be part of a name here; pick one without them` };
}
