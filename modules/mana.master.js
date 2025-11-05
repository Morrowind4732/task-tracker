// mana.Master.js
// Utility module for mana icon rendering / cost parsing for your tabletop simulator project.

const CLASS_MAP = {
  // single letters
  W: 'w', U: 'u', B: 'b', R: 'r', G: 'g', C: 'c', S: 'snow', // S = snow
  X: 'x', Y: 'y', Z: 'z',
  // actions / other
  T: 'tap',
  Q: 'untap',
  // phyrexian
  'W/P': 'wp', 'U/P': 'up', 'B/P': 'bp', 'R/P': 'rp', 'G/P': 'gp', 'P': 'p',
  // hybrid (order doesn’t matter; we normalize to sorted lowercase pair)
  'W/U': 'wu', 'U/W': 'wu',
  'W/B': 'wb', 'B/W': 'wb',
  'U/B': 'ub', 'B/U': 'ub',
  'U/R': 'ur', 'R/U': 'ur',
  'B/R': 'br', 'R/B': 'br',
  'R/G': 'rg', 'G/R': 'rg',
  'G/W': 'gw', 'W/G': 'gw',
  'G/U': 'gu', 'U/G': 'gu',
  // two-color generic hybrids like 2/W
  '2/W': '2w', '2/U': '2u', '2/B': '2b', '2/R': '2r', '2/G': '2g'
};

// Numbers 0–20 (extend if you need more)
for (let n = 0; n <= 20; n++) CLASS_MAP[String(n)] = String(n);

/** Normalize a token like "G/U" or "T" into a mana font class suffix. */
function tokenToClass(tokenRaw) {
  const t = String(tokenRaw).toUpperCase().trim();

  // Direct map first
  if (CLASS_MAP[t]) return CLASS_MAP[t];

  // Handle hybrids generically: A/B → ab (sorted)
  if (t.includes('/')) {
    const parts = t.split('/').map(s => s.trim());
    if (parts.length === 2) {
      const a = parts[0], b = parts[1];
      // phyrexian already covered above; fall back to sorted pair
      const pair = [a, b].sort().join('').toLowerCase();
      return pair; // e.g. "gw", "ur"
    }
  }

  // Fallback to plain lowercase (works for 0–20, C, X, etc.)
  return t.toLowerCase();
}

/**
 * Return the HTML string for a single mana symbol.
 * @param {string} sym The symbol code (e.g., "R", "2", "G/U", "T")
 * @param {object} [options] Options: { cost: boolean, shadow: boolean, size: string ("2x"), fixed: boolean }
 */
export function manaIcon(sym, options = {}) {
  const { cost = true, shadow = true, size = "", fixed = false } = options;
  const normalized = String(sym).replace(/[{}]/g, "");
  const suffix = tokenToClass(normalized);
  const classList = ["ms", `ms-${suffix}`];
  if (cost)   classList.push("ms-cost");
  if (shadow) classList.push("ms-shadow");
  if (size)   classList.push(`ms-${size}`);
  if (fixed)  classList.push("ms-fw");
  return `<i class="${classList.join(" ")}"></i>`;
}

/** Parse a mana-cost string like "{2}{G/U}{R}{X}" into ["2","G/U","R","X"]. */
export function parseManaCost(costString) {
  const regex = /\{([^}]+)\}/g;
  const out = [];
  let m;
  while ((m = regex.exec(String(costString))) !== null) out.push(m[1]);
  return out;
}

/** Replace all {...} tokens in a string with icon markup. */
export function manaCostHtml(str) {
  return String(str).replace(/\{([^}]+)\}/g, (_, tok) => manaIcon(tok));
}

/** Inline render into an element (e.g., a button) */
export function renderInline(el, str) {
  if (!el) return;
  el.innerHTML = manaCostHtml(str);
}

/** Scan a root node for elements with data-mana and render them. */
export function scan(root = document) {
  const nodes = root.querySelectorAll?.('[data-mana]');
  nodes?.forEach(n => renderInline(n, n.getAttribute('data-mana')));
}

// ---- expose a tiny global for non-module callers (badges.js uses this) ----
if (typeof window !== 'undefined') {
  window.ManaMaster = window.ManaMaster || {};
  Object.assign(window.ManaMaster, { manaIcon, parseManaCost, manaCostHtml, renderInline, scan });
}
