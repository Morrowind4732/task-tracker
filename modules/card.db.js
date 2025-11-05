// modules/card.db.js
// Tiny in-memory card metadata DB keyed by lowercase name.
// Stores: title, manaCost, typeLine, oracle, power, toughness, faces[], hasBack

export const CardDB = (() => {
  const byName = new Map(); // nameLower -> meta

  function normalizeFromScry(card) {
    // Single-faced
    if (!Array.isArray(card.card_faces) || card.card_faces.length === 0) {
      return {
        title: card.name || '',
        manaCost: card.mana_cost || '',
        typeLine: card.type_line || '',
        oracle: card.oracle_text || '',
        power: card.power ?? '',
        toughness: card.toughness ?? '',
        imageUrl: card.image_uris?.normal || '',
        faces: [],
        hasBack: false
      };
    }

    // Double-faced / MDFC
    const faces = card.card_faces.map((f) => ({
      title: f.name || '',
      manaCost: f.mana_cost || '',
      typeLine: f.type_line || '',
      oracle: f.oracle_text || '',
      power: f.power ?? '',
      toughness: f.toughness ?? '',
      imageUrl: f.image_uris?.normal || ''
    }));
    const f0 = faces[0] || {};
    return {
      title: card.name || f0.title || '',
      manaCost: f0.manaCost || '',
      typeLine: card.type_line || f0.typeLine || '',
      oracle: f0.oracle || '',
      power: f0.power ?? '',
      toughness: f0.toughness ?? '',
      imageUrl: f0.imageUrl || '',
      faces,
      hasBack: faces.length > 1
    };
  }

  function putManyFromScryfall(cards) {
    for (const c of (cards || [])) {
      const meta = normalizeFromScry(c);
      const key = (c.name || meta.title || '').toLowerCase();
      if (!key) continue;
      byName.set(key, meta);
    }
  }

  function put(name, meta) {
    if (!name) return;
    byName.set(String(name).toLowerCase(), { ...(meta || {}) });
  }

  function getByName(name) {
    if (!name) return null;
    return byName.get(String(name).toLowerCase()) || null;
  }

  return { put, putManyFromScryfall, getByName };
})();
