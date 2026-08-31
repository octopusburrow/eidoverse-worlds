// style — live token editing (R, 16:58: "There will be a test. 😉").
// Three swatches drive the token sheet directly: if any hex is hiding
// outside :root, the picker exposes it by NOT restyling that element.
// Persisted per-browser; "reset" returns to the sheet's own values.

import { makeSection } from './ui.js';

const LS = 'ew-style-tokens';
const FIELDS = [
  { key: '--panel-rgb', label: 'panel',     kind: 'rgbTriplet' },
  { key: '--brand',     label: 'accent',    kind: 'hex' },
  { key: '--attn',      label: 'attention', kind: 'hex' },
];

const rootStyle = () => document.documentElement.style;
const hexToTriplet = (h) => {
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const tripletToHex = (t) => {
  const p = t.trim().split(/\s+/).map(Number);
  return '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('');
};

function load() { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } }
function save(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch {} }

export function applyStyleTokens() {
  const o = load();
  for (const [k, v] of Object.entries(o)) rootStyle().setProperty(k, v);
}

function currentHex(f) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(f.key).trim();
  return f.kind === 'rgbTriplet' ? tripletToHex(v) : v;
}

export function initStylePanel() {
  applyStyleTokens();
  makeSection('🎨 style', (body) => {
    body.innerHTML = '';
    for (const f of FIELDS) {
      const row = document.createElement('label');
      row.className = 'row';
      row.style.cssText = 'display:flex;align-items:center;gap:10px;';
      const sw = document.createElement('input');
      sw.type = 'color';
      sw.value = currentHex(f);
      sw.style.cssText = 'width:26px;height:20px;padding:0;border:none;background:none;cursor:pointer;';
      sw.oninput = () => {
        const v = f.kind === 'rgbTriplet' ? hexToTriplet(sw.value) : sw.value;
        rootStyle().setProperty(f.key, v);
        const o = load(); o[f.key] = v; save(o);
      };
      const name = document.createElement('span');
      name.textContent = f.label;
      row.append(sw, name);
      body.appendChild(row);
    }
    const reset = document.createElement('button');
    reset.textContent = 'reset to defaults';
    reset.style.cssText = 'margin-top:6px;';
    reset.onclick = () => {
      for (const f of FIELDS) rootStyle().removeProperty(f.key);
      save({});
      // repaint swatches from the sheet's own values
      const inputs = reset.parentElement.querySelectorAll('input[type=color]');
      FIELDS.forEach((f, i) => { inputs[i].value = currentHex(f); });
    };
    body.appendChild(reset);
  }, { id: 'style', host: 'settings' });
}
