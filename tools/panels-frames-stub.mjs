// panels-test substitutes this for frames.js (renderers under test never touch it).
export function makeFrame() {
  const body = document.createElement('div');
  return { body, show() {}, hide() {}, toggle() {}, state: {}, badge() {} };
}
