// /modules/oracle.innate.js
// Extracts INNATE evergreen abilities from Oracle text,
// matching the tooltip's "basic keywords only" behavior.
// - Strips reminder text "(...)"
// - Only reads headline/keyword headers at the START of a line
// - Splits comma/and lists like "First strike, vigilance, lifelink"
// - Rejects "hexproof from ..." and ANY "Protection from ..."
// - Returns Title-Cased unique list, in encounter order.

export function extractInnateAbilities(oracleText) {
  if (!oracleText) return [];

  // 1) Remove reminder text so "(damage dealt by this creature…)" doesn't trip matches
  const noReminder = String(oracleText).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  // 2) Per-line scan; only consider abilities in the "header" at line start
  const lines = noReminder.split(/\r?\n/);

  // Canon map (lower → canonical)
  const CANON = new Map([
    ['flying', 'Flying'],
    ['first strike', 'First Strike'],
    ['double strike', 'Double Strike'],
    ['vigilance', 'Vigilance'],
    ['lifelink', 'Lifelink'],
    ['deathtouch', 'Deathtouch'],
    ['trample', 'Trample'],
    ['haste', 'Haste'],
    ['defender', 'Defender'],
    ['hexproof', 'Hexproof'],          // but not "hexproof from ..."
    ['indestructible', 'Indestructible'],
    ['menace', 'Menace'],
    ['ward', 'Ward'],                  // e.g., "Ward {2}" → "Ward"
    ['battle cry', 'Battle Cry'],
    ['exalted', 'Exalted'],
  ]);

  // Build a start-of-line alternation, longest-first so "double strike" beats "strike"
  const keys = Array.from(CANON.keys())
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // escape regex

  // Match group of keywords at line start, possibly comma/and separated, up to a hard break
  // Examples it catches:
  //   "First strike, vigilance, lifelink"
  //   "Ward — Pay 3 life."
  //   "Haste"
  // It stops before a colon, em dash, period, or digit/brace (for costs) if present.
  const startRegex = new RegExp(
    '^\\s*(?:' + keys.join('|') + ')(?:\\s*(?:,|and)\\s*(?:' + keys.join('|') + '))*\\b'
  , 'i');

  const out = [];
  const seen = new Set();

  for (let raw of lines) {
    if (!raw || !raw.trim()) continue;

    const line = raw.trim();

    // Quick hard rejections on “Protection from …” lines
    if (/^protection\s+from\b/i.test(line)) continue;

    const m = line.match(startRegex);
    if (!m) continue;

    // Header segment = matched slice at start; isolate it (before punctuation/cost)
    // e.g., "First strike, vigilance, lifelink" → that whole chunk
    let head = m[0];

    // Split by commas/and
    const parts = head
      .split(/\s*,\s*|\s+and\s+/i)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    for (let p of parts) {
      // Reject conditional variants:
      // - "hexproof from X"
      if (/^hexproof\s+from\b/i.test(p)) continue;

      // Already rejected "Protection from ..." at line-level, but be safe:
      if (/^protection\s+from\b/i.test(p)) continue;

      // Normalize to canonical if recognized
      const key = CANON.has(p) ? p : null;
      if (!key) continue;

      const label = CANON.get(key);
      if (!seen.has(label)) {
        seen.add(label);
        out.push(label);
      }
    }
  }

  return out;
}
