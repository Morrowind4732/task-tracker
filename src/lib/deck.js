export const DEFAULT_DEBUG_DECK = `1 Arcane Signet
1 Beast Within
1 Bellowing Tanglewurm
1 Blighted Woodland
1 Bramble Wurm
1 Castle Garenbrig
1 Circle of Dreams Druid
1 Colossal Majesty
1 Craterhoof Behemoth
1 Crush of Wurms
1 Cultivate
1 Defiler of Vigor
1 Desert of the Indomitable
1 Elderscale Wurm
1 Elemental Bond
1 Elvish Mystic
1 Emergent Woodwurm
1 Engulfing Slagwurm
1 Fanatic of Rhonas
1 Farseek
32 Forest
1 Frenzied Baloth
1 Garruk, Primal Hunter
1 Garruk's Uprising
1 Greater Good
1 Greater Sandwurm
1 Heroic Intervention
1 Impervious Greatwurm
1 Karametra's Acolyte
1 Kodama's Reach
1 Last March of the Ents
1 Llanowar Elves
1 Magewright's Stone
1 Monster Manual
1 Monstrous Vortex
1 Mosswort Bridge
1 Naturalize
1 Oran-Rief, the Vastwood
1 Ouroboroid
1 Panglacial Wurm
1 Patriar's Seal
1 Pelakka Wurm
1 Penumbra Wurm
1 Plated Slagwurm
1 Pounce
1 Pouncing Wurm
1 Quilled Greatwurm
1 Ram Through
1 Return of the Wildspeaker
1 Rhonas's Monument
1 Rishkar's Expertise
1 Sandwurm Convergence
1 Saryth, the Viper's Fang
1 Scryb Ranger
1 Seeker of Skybreak
1 Siege Wurm
1 Sifter Wurm
1 Skyshroud Claim
1 Sol Ring
1 Stoneforge Masterwork
1 Three Visits
1 Tranquil Thicket
1 Traverse the Outlands
1 Unnatural Growth
1 Up the Beanstalk
1 Urza's Incubator
1 Worldspine Wurm
1 Wrap in Vigor

1 Baru, Wurmspeaker`;

const IMPORT_DEBUG_PAGE_SIZE = 12;
const SIDEBOARD_HEADERS = new Set(['sideboard', 'side board', 'maybeboard', 'maybe board', 'considering', 'tokens']);
const COMMANDER_HEADERS = new Set(['commander', 'commanders', 'commander(s)', 'partner commander', 'partner commanders']);
const MAIN_DECK_HEADERS = new Set(['deck', 'main', 'main deck', 'maindeck', 'creatures', 'artifacts', 'enchantments', 'instants', 'sorceries', 'lands', 'planeswalkers', 'battle', 'battles', 'spells']);

function normalizeDebugKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSectionHeader(line) {
  const cleaned = String(line || '').trim().replace(/:$/, '').trim().toLowerCase();
  if (!cleaned) return null;
  if (SIDEBOARD_HEADERS.has(cleaned)) return 'sideboard';
  if (COMMANDER_HEADERS.has(cleaned)) return 'commander';
  if (MAIN_DECK_HEADERS.has(cleaned)) return 'main';
  return null;
}

function stripDecklistCardName(rawName) {
  let name = String(rawName || '').trim();
  name = name.replace(/\s+#.*$/g, '').trim();
  name = name.replace(/\s+\[[^\]]+\]\s*$/g, '').trim();
  name = name.replace(/\s+\*[^*]+\*\s*$/g, '').trim();
  // Common Moxfield/Archidekt/MTGGoldfish style: Sol Ring (LTC) 312
  name = name.replace(/\s+\([A-Z0-9]{2,6}\)\s*[A-Za-z0-9★#-]*\s*$/g, '').trim();
  // Common Arena style: 1 Sol Ring (LTC) 312 *F*
  name = name.replace(/\s+\([A-Z0-9]{2,6}\)\s*$/g, '').trim();
  // Common trailing collector number after a set was already stripped.
  name = name.replace(/\s+\d{1,4}[a-z]?\s*$/i, '').trim();
  return name;
}

function parseDeckLine(rawLine, currentSection, lineNumber) {
  const original = String(rawLine || '');
  let cleaned = original
    .trim()
    .replace(/^[-•*]\s*/, '')
    .replace(/^\d+\.\s*/, '')
    .trim();

  if (!cleaned) return null;
  if (cleaned.startsWith('//')) return null;
  const header = normalizeSectionHeader(cleaned);
  if (header) return { header, rawLine: original, lineNumber };

  const match = cleaned.match(/^(\d+)\s*(?:x\s*)?(.+)$/i);
  if (!match) return {
    ignored: true,
    reason: 'No leading quantity found. Expected lines like “1 Sol Ring”.',
    rawLine: original,
    lineNumber,
    section: currentSection || 'main'
  };

  const count = Math.max(1, Number(match[1]) || 1);
  const name = stripDecklistCardName(match[2]);
  if (!name) return {
    ignored: true,
    reason: 'Quantity was found but no card name remained after cleanup.',
    rawLine: original,
    lineNumber,
    section: currentSection || 'main'
  };

  return {
    count,
    name,
    rawLine: original,
    lineNumber,
    section: currentSection || 'main'
  };
}

export function parseDeckListDetailed(rawText) {
  const source = String(rawText || '');
  const rawLines = source.split(/\r?\n/);
  let currentSection = 'main';
  const entries = [];
  const ignoredLines = [];
  const sectionEvents = [];

  rawLines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    if (trimmed.startsWith('//')) {
      ignoredLines.push({ lineNumber, rawLine: line, reason: 'Comment line' });
      return;
    }
    const parsed = parseDeckLine(line, currentSection, lineNumber);
    if (!parsed) return;
    if (parsed.header) {
      currentSection = parsed.header;
      sectionEvents.push({ lineNumber, rawLine: line, section: parsed.header });
      return;
    }
    if (parsed.ignored) {
      ignoredLines.push(parsed);
      return;
    }
    entries.push(parsed);
  });

  const commanderEntry = pickCommanderEntry(entries);
  const deckEntries = entries.filter((entry) => {
    if (entry === commanderEntry) return true;
    return entry.section !== 'sideboard';
  });
  const sideboardEntries = entries.filter((entry) => entry.section === 'sideboard' && entry !== commanderEntry);
  const sectionCounts = entries.reduce((acc, entry) => {
    const key = entry.section || 'main';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    entries,
    deckEntries,
    sideboardEntries,
    ignoredLines,
    sectionEvents,
    sectionCounts,
    commanderEntry,
    commanderName: commanderEntry?.name || '',
    commanderDetection: commanderEntry?.section === 'commander'
      ? 'commander section'
      : commanderEntry
        ? 'last parsed card line fallback'
        : 'none',
    rawLineCount: rawLines.length
  };
}

function pickCommanderEntry(entries) {
  const commanderSectionEntry = entries.find((entry) => entry.section === 'commander');
  if (commanderSectionEntry) return commanderSectionEntry;
  return entries[entries.length - 1] || null;
}

export function parseDeckList(rawText) {
  return parseDeckListDetailed(rawText).deckEntries.map(({ count, name }) => ({ count, name }));
}

function getImage(card) {
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (card.image_uris?.large) return card.image_uris.large;
  if (card.card_faces?.[0]?.image_uris?.normal) return card.card_faces[0].image_uris.normal;
  if (card.card_faces?.[0]?.image_uris?.large) return card.card_faces[0].image_uris.large;
  return null;
}

function normalizeScryfallCard(card) {
  const faces = card.card_faces || [];
  const combinedOracle = card.oracle_text || faces.map((face) => {
    const parts = [face.name, face.type_line, face.oracle_text].filter(Boolean);
    return parts.join('\n');
  }).filter(Boolean).join('\n\n//\n\n');
  const primaryFace = faces[0] || {};
  return {
    scryfallId: card.id,
    name: card.name,
    typeLine: card.type_line || primaryFace.type_line || '',
    oracleText: combinedOracle || primaryFace.oracle_text || '',
    manaCost: card.mana_cost || primaryFace.mana_cost || '',
    manaValue: Number(card.cmc || 0),
    power: card.power || primaryFace.power || '',
    toughness: card.toughness || primaryFace.toughness || '',
    image: getImage(card),
    colors: card.colors || card.color_identity || [],
    raw: {
      rarity: card.rarity,
      set: card.set,
      collectorNumber: card.collector_number,
      uri: card.scryfall_uri,
      cardFaces: faces
    }
  };
}

function fallbackCard(name) {
  return {
    scryfallId: `fallback-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    typeLine: name.toLowerCase().includes('forest') ? 'Basic Land — Forest' : 'Unknown Card',
    oracleText: 'Scryfall lookup failed or this card was not found. Placeholder generated locally.',
    manaCost: '',
    manaValue: name.toLowerCase().includes('forest') ? 0 : 1,
    power: '',
    toughness: '',
    image: null,
    colors: [],
    raw: {}
  };
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function cardAliases(card) {
  return [card.name, ...((card.card_faces || []).map((face) => face.name))].filter(Boolean);
}

function addCardAliasesToMap(cardMap, card, normalized, extraAliases = []) {
  const aliases = [...extraAliases, normalized.name, ...((normalized.raw?.cardFaces || []).map((face) => face.name))].filter(Boolean);
  for (const alias of aliases) cardMap.set(String(alias).toLowerCase(), normalized);
  for (const alias of cardAliases(card)) cardMap.set(String(alias).toLowerCase(), normalized);
}

async function resolveMissingCard(name, options = {}, debugLookup = null) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return options.allowFallback !== false ? fallbackCard('Unknown Card') : null;

  const tryUrls = [
    { mode: 'named fuzzy', url: `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}` }
  ];

  const faceCandidates = cleanName.split(/\s*\/\/\s*/).map((part) => part.trim()).filter(Boolean);
  for (const face of faceCandidates) {
    if (face.toLowerCase() !== cleanName.toLowerCase()) {
      tryUrls.push({ mode: 'face fuzzy', url: `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(face)}`, face });
    }
  }
  tryUrls.push({ mode: 'exact search', url: `https://api.scryfall.com/cards/search?unique=cards&order=released&q=${encodeURIComponent('!' + '"' + cleanName + '"')}` });
  tryUrls.push({ mode: 'broad search', url: `https://api.scryfall.com/cards/search?unique=cards&order=released&q=${encodeURIComponent(cleanName)}` });

  for (const attempt of tryUrls) {
    try {
      const response = await fetch(attempt.url);
      debugLookup?.attempts?.push({ mode: attempt.mode, ok: response.ok, status: response.status, statusText: response.statusText });
      if (!response.ok) continue;
      const data = await response.json();
      const card = data.object === 'card' ? data : (Array.isArray(data.data) ? data.data.find((item) => {
        const names = [item.name, ...(item.card_faces || []).map((face) => face.name)].filter(Boolean).map((value) => value.toLowerCase());
        const clean = cleanName.toLowerCase();
        return names.includes(clean) || names.some((value) => value.includes(clean) || clean.includes(value));
      }) || data.data[0] : null);
      if (card) {
        const normalized = normalizeScryfallCard(card);
        if (debugLookup) {
          debugLookup.status = attempt.mode;
          debugLookup.resultName = normalized.name;
          debugLookup.scryfallId = normalized.scryfallId;
          debugLookup.image = Boolean(normalized.image);
        }
        return normalized;
      }
    } catch (error) {
      debugLookup?.attempts?.push({ mode: attempt.mode, ok: false, error: error?.message || String(error) });
    }
  }

  if (debugLookup) {
    debugLookup.status = 'fallback';
    debugLookup.resultName = cleanName;
    debugLookup.scryfallId = `fallback-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    debugLookup.image = false;
  }
  return options.allowFallback !== false ? fallbackCard(cleanName) : null;
}

function buildImportDebugBase({ command = 'deck_import_debug', sourceText, parsed }) {
  return {
    command,
    generatedAt: new Date().toLocaleString(),
    pageSize: IMPORT_DEBUG_PAGE_SIZE,
    rawLineCount: parsed.rawLineCount,
    parsedEntryCount: parsed.entries.length,
    loadedEntryCount: parsed.deckEntries.length,
    sideboardEntryCount: parsed.sideboardEntries.length,
    ignoredLineCount: parsed.ignoredLines.length,
    sectionCounts: parsed.sectionCounts,
    sectionEvents: parsed.sectionEvents,
    ignoredLines: parsed.ignoredLines,
    commanderName: parsed.commanderName,
    commanderDetection: parsed.commanderDetection,
    totalCardInstances: parsed.deckEntries.reduce((sum, entry) => sum + Number(entry.count || 0), 0),
    uniqueNames: [...new Set(parsed.deckEntries.map((entry) => entry.name))].length,
    lookupChunks: [],
    lookupByName: {},
    items: [],
    errors: [],
    sourceWasDefaultFallback: !String(sourceText || '').trim()
  };
}

export async function loadDeckFromText(rawText, options = {}) {
  const sourceText = rawText?.trim() ? rawText : DEFAULT_DEBUG_DECK;
  const parsed = parseDeckListDetailed(sourceText);
  const entries = parsed.deckEntries.map(({ count, name }) => ({ count, name }));
  const debug = options.debug ? buildImportDebugBase({ command: options.debugCommand || 'deck_import_debug', sourceText, parsed }) : null;

  if (!entries.length) {
    const error = new Error('No valid deck lines found. Use lines like: 1 Arcane Signet');
    if (debug) error.importDebug = debug;
    throw error;
  }

  const commanderEntry = parsed.commanderEntry || parsed.deckEntries[parsed.deckEntries.length - 1] || parsed.entries[parsed.entries.length - 1];
  const uniqueNames = [...new Set(entries.map((entry) => entry.name))];
  const cardMap = new Map();
  const lookupStatus = new Map();

  const chunks = chunk(uniqueNames, 70);
  for (const names of chunks) {
    const chunkDebug = debug ? { requested: names, found: [], notFound: [], status: 'pending' } : null;
    try {
      const response = await fetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: names.map((name) => ({ name })) })
      });
      if (!response.ok) {
        chunkDebug && Object.assign(chunkDebug, { status: 'http_error', httpStatus: response.status, statusText: response.statusText });
        if (options.allowFallback !== false) {
          names.forEach((name) => {
            const fallback = fallbackCard(name);
            cardMap.set(name.toLowerCase(), fallback);
            lookupStatus.set(name.toLowerCase(), { originalName: name, status: 'fallback_after_collection_http_error', resultName: fallback.name, scryfallId: fallback.scryfallId, image: false });
          });
          debug?.lookupChunks.push(chunkDebug);
          continue;
        }
        throw new Error(`Scryfall lookup failed: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      chunkDebug && Object.assign(chunkDebug, { status: 'ok', foundCount: (data.data || []).length, notFoundCount: (data.not_found || []).length });
      for (const card of data.data || []) {
        const normalized = normalizeScryfallCard(card);
        addCardAliasesToMap(cardMap, card, normalized);
        chunkDebug?.found.push(normalized.name);
        for (const alias of cardAliases(card)) {
          const key = normalizeDebugKey(alias);
          lookupStatus.set(key, { originalName: alias, status: 'collection', resultName: normalized.name, scryfallId: normalized.scryfallId, image: Boolean(normalized.image) });
        }
      }
      for (const missing of data.not_found || []) {
        const name = String(missing.name || missing.id || 'Unknown Card');
        const debugLookup = debug ? { originalName: name, status: 'not_found', attempts: [] } : null;
        const resolved = await resolveMissingCard(name, options, debugLookup);
        if (resolved) {
          cardMap.set(name.toLowerCase(), resolved);
          lookupStatus.set(name.toLowerCase(), debugLookup || { originalName: name, status: 'resolved_missing', resultName: resolved.name, scryfallId: resolved.scryfallId, image: Boolean(resolved.image) });
          for (const alias of [resolved.name, ...((resolved.raw?.cardFaces || []).map((face) => face.name))].filter(Boolean)) {
            cardMap.set(String(alias).toLowerCase(), resolved);
          }
        } else {
          const fallback = fallbackCard(name);
          cardMap.set(name.toLowerCase(), fallback);
          lookupStatus.set(name.toLowerCase(), { originalName: name, status: 'fallback', resultName: fallback.name, scryfallId: fallback.scryfallId, image: false });
        }
        chunkDebug?.notFound.push(debugLookup || { originalName: name, status: 'not_found' });
      }
    } catch (error) {
      chunkDebug && Object.assign(chunkDebug, { status: 'fetch_exception', error: error?.message || String(error) });
      if (options.allowFallback === false) throw error;
      names.forEach((name) => {
        const fallback = fallbackCard(name);
        cardMap.set(name.toLowerCase(), fallback);
        lookupStatus.set(name.toLowerCase(), { originalName: name, status: 'fallback_after_fetch_exception', resultName: fallback.name, scryfallId: fallback.scryfallId, image: false, error: error?.message || String(error) });
      });
    } finally {
      if (chunkDebug) debug.lookupChunks.push(chunkDebug);
    }
  }

  const expanded = [];
  for (const entry of entries) {
    const base = cardMap.get(entry.name.toLowerCase()) || fallbackCard(entry.name);
    for (let i = 0; i < entry.count; i += 1) {
      expanded.push({
        ...base,
        instanceId: crypto.randomUUID(),
        deckName: entry.name,
        copyIndex: i + 1
      });
    }
  }

  const commanderBase = cardMap.get(commanderEntry?.name?.toLowerCase?.() || '') || (commanderEntry ? fallbackCard(commanderEntry.name) : fallbackCard('Unknown Commander'));

  if (debug) {
    debug.commanderImagePresent = Boolean(commanderBase.image);
    debug.commanderLookupStatus = lookupStatus.get(normalizeDebugKey(commanderEntry?.name)) || null;
    debug.items = parsed.entries.map((entry) => {
      const status = lookupStatus.get(normalizeDebugKey(entry.name)) || null;
      const includedInDeck = parsed.deckEntries.includes(entry);
      const role = entry === commanderEntry ? 'commander' : includedInDeck ? 'deck' : 'sideboard/ignored';
      return {
        lineNumber: entry.lineNumber,
        rawLine: entry.rawLine,
        parsedCount: entry.count,
        parsedName: entry.name,
        section: entry.section || 'main',
        role,
        includedInDeck,
        lookupStatus: status?.status || 'not requested',
        resultName: status?.resultName || '',
        scryfallId: status?.scryfallId || '',
        image: Boolean(status?.image),
        error: status?.error || '',
        attempts: status?.attempts || []
      };
    });
    debug.lookupByName = Object.fromEntries([...lookupStatus.entries()].map(([key, value]) => [key, value]));
    debug.fallbackCount = debug.items.filter((item) => /fallback/i.test(item.lookupStatus)).length;
    debug.notRequestedCount = debug.items.filter((item) => item.lookupStatus === 'not requested').length;
    debug.missingImageCount = debug.items.filter((item) => item.includedInDeck && !item.image).length;
    debug.foundCount = debug.items.filter((item) => item.includedInDeck && item.lookupStatus && !/fallback|not requested/i.test(item.lookupStatus)).length;
  }

  return {
    entries,
    cards: expanded,
    commander: { ...commanderBase, instanceId: crypto.randomUUID() },
    commanderName: commanderEntry?.name || 'Unknown Commander',
    usedFallbackText: !rawText?.trim(),
    totalCards: expanded.length,
    importDebug: debug
  };
}

function formatImportDebugHeader(report = {}) {
  const sections = Object.entries(report.sectionCounts || {}).map(([key, value]) => `${key}: ${value}`).join(', ') || 'none';
  const chunks = (report.lookupChunks || []).map((chunk, index) => `Chunk ${index + 1}: ${chunk.status}${chunk.httpStatus ? ` ${chunk.httpStatus}` : ''}${chunk.error ? ` — ${chunk.error}` : ''}; requested ${chunk.requested?.length || 0}, found ${chunk.foundCount ?? chunk.found?.length ?? 0}, not_found ${chunk.notFoundCount ?? chunk.notFound?.length ?? 0}`).join('\n') || 'No lookup chunks recorded.';
  const ignored = (report.ignoredLines || []).slice(0, 12).map((line) => `Line ${line.lineNumber}: ${line.reason} :: ${line.rawLine}`).join('\n') || 'None';
  return [
    'DECK IMPORT DEBUG REPORT',
    `Command: ${report.command || 'deck_import_debug'}`,
    `Generated: ${report.generatedAt || new Date().toLocaleString()}`,
    `Raw lines: ${report.rawLineCount || 0}`,
    `Parsed entries: ${report.parsedEntryCount || 0}`,
    `Loaded entries: ${report.loadedEntryCount || 0}`,
    `Loaded card instances: ${report.totalCardInstances || 0}`,
    `Unique names sent to Scryfall: ${report.uniqueNames || 0}`,
    `Sideboard/ignored entries: ${report.sideboardEntryCount || 0}`,
    `Ignored non-card lines: ${report.ignoredLineCount || 0}`,
    `Commander detected: ${report.commanderName || 'none'} (${report.commanderDetection || 'unknown'})`,
    `Commander image present: ${report.commanderImagePresent ? 'yes' : 'no'}`,
    `Scryfall found/resolved loaded rows: ${report.foundCount || 0}`,
    `Fallback rows: ${report.fallbackCount || 0}`,
    `Loaded rows missing image: ${report.missingImageCount || 0}`,
    `Section counts: ${sections}`,
    '',
    'Lookup chunks:',
    chunks,
    '',
    'Ignored line samples:',
    ignored
  ].join('\n');
}

export function formatDeckImportDebugReportPage(report = {}, page = 0) {
  const pageSize = report.pageSize || IMPORT_DEBUG_PAGE_SIZE;
  const items = report.items || [];
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  const lines = [
    formatImportDebugHeader(report),
    '',
    `Page ${safePage + 1} of ${totalPages} — showing ${pageItems.length} parsed card line(s), max ${pageSize} per page`,
    ''
  ];
  pageItems.forEach((item, index) => {
    lines.push(`===== ${start + index + 1}. Line ${item.lineNumber}: ${item.parsedName} =====`);
    lines.push(`Raw line: ${item.rawLine}`);
    lines.push(`Parsed quantity: ${item.parsedCount}`);
    lines.push(`Parsed name sent to Scryfall: ${item.parsedName}`);
    lines.push(`Section: ${item.section}`);
    lines.push(`Role: ${item.role}`);
    lines.push(`Included in loaded deck: ${item.includedInDeck ? 'yes' : 'no'}`);
    lines.push(`Scryfall status: ${item.lookupStatus}`);
    lines.push(`Resolved name: ${item.resultName || 'none'}`);
    lines.push(`Scryfall ID: ${item.scryfallId || 'none'}`);
    lines.push(`Image present: ${item.image ? 'yes' : 'no'}`);
    if (item.error) lines.push(`Error: ${item.error}`);
    if (item.attempts?.length) {
      lines.push('Fallback attempts:');
      item.attempts.forEach((attempt) => lines.push(`- ${attempt.mode}: ${attempt.ok ? 'ok' : 'failed'}${attempt.status ? ` (${attempt.status})` : ''}${attempt.error ? ` — ${attempt.error}` : ''}`));
    }
    lines.push('');
  });
  if (!pageItems.length) lines.push('No parsed card lines found on this page.');
  return lines.join('\n');
}

export function formatDeckImportDebugReportAll(report = {}) {
  const items = report.items || [];
  const pageSize = report.pageSize || IMPORT_DEBUG_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  return Array.from({ length: totalPages }, (_, page) => formatDeckImportDebugReportPage(report, page)).join('\n\n----- NEXT PAGE -----\n\n');
}

export function shuffleCards(cards) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function isLand(card) {
  return /\bLand\b/i.test(card?.typeLine || '');
}

export function likelyZoneForCard(card) {
  const type = card?.typeLine || '';
  if (/\bLand\b/i.test(type)) return 'mana';
  if (/\bCreature\b/i.test(type)) return 'creatures';
  if (/\bEnchantment\b|\bAura\b/i.test(type)) return 'enchantments';
  if (/\bArtifact\b|\bEquipment\b/i.test(type)) return 'artifacts';
  return 'holding';
}
