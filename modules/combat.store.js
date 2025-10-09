// modules/combat.store.js
// Supabase-backed combat state: one row per game in table "combats" keyed by game_id.
// Works with window.supabase client if present; otherwise uses REST with window.SUPABASE_URL/KEY.

// ---------- env detection ----------
const SB = (typeof window !== "undefined" ? window.supabase : null);
const SB_URL = (typeof window !== "undefined" && (window.SUPABASE_URL || window?.env?.supabase?.url)) || "";
const SB_KEY = (typeof window !== "undefined" && (window.SUPABASE_KEY || window?.env?.supabase?.key)) || "";

function assertEnv() {
  if (!SB && (!SB_URL || !SB_KEY)) {
    throw new Error("[CombatStore] Missing Supabase env (url/key).");
  }
}

// ---------- REST helper (fallback when no client) ----------
async function rest(method, path, { query = "", body = null, headers = {} } = {}) {
  assertEnv();
  const url = `${SB_URL.replace(/\/$/, "")}${path}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      "apikey": SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Prefer": "return=representation",
      ...headers
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>"");
    throw new Error(`[CombatStore REST] ${method} ${path} ${res.status} ${res.statusText} :: ${text}`);
  }
  return res.json().catch(() => null);
}

// ---------- shape helpers ----------
const TABLE = "combats"; // <-- keep this plural to match the rest of your app

function normalize(row) {
  if (!row) return null;
  return {
    attackingSeat: row.attacking_seat ?? row.attackingSeat ?? 0,
    attacks: row.attacks || {},
    blocksByDefender: row.blocks_by_defender || row.blocksByDefender || {},
    recommendedOutcome: row.recommended_outcome || row.recommendedOutcome || null,
    applied: row.applied || {},
    phase: row.phase || null,
    epoch: row.epoch || 0,
    updatedAt: row.updated_at || null,
    game_id: row.game_id ?? null,
  };
}

function toRowPatch(patch = {}) {
  return {
    attacking_seat: patch.attackingSeat ?? undefined,
    attacks: patch.attacks ?? undefined,
    blocks_by_defender: patch.blocksByDefender ?? undefined,
    recommended_outcome: patch.recommendedOutcome ?? undefined,
    applied: patch.applied ?? undefined,
    epoch: patch.epoch ?? Date.now(),
    updated_at: new Date().toISOString(),
  };
}



// ---------- core ops ----------
async function readRow(gameId) {
  if (SB) {
    const { data, error } = await SB.from(TABLE).select("*").eq("game_id", String(gameId)).maybeSingle();
    if (error && error.code !== "PGRST116") throw error; // "Results contain 0 rows"
    return normalize(data || null);
  } else {
    const rows = await rest("GET", `/rest/v1/${TABLE}`, {
      query: `select=*&game_id=eq.${encodeURIComponent(String(gameId))}`
    });
    return normalize(rows?.[0] || null);
  }
}

async function upsertRow(gameId, patch) {
  const payload = { game_id: String(gameId), ...toRowPatch(patch) };
  if (SB) {
    const { data, error } = await SB
      .from(TABLE)
      .upsert(payload, { onConflict: "game_id", ignoreDuplicates: false })
      .select()
      .maybeSingle();
    if (error) throw error;
    return normalize(data);
  } else {
    const res = await rest("POST", `/rest/v1/${TABLE}`, {
      body: payload,
      headers: { Prefer: "resolution=merge-duplicates,return=representation" }
    });
    return normalize(Array.isArray(res) ? res[0] : res);
  }
}

async function updateRow(gameId, patch) {
  const payload = toRowPatch(patch);
  if (SB) {
    const { data, error } = await SB
      .from(TABLE)
      .update(payload)
      .eq("game_id", String(gameId))
      .select()
      .maybeSingle();
    if (error) throw error;
    return normalize(data);
  } else {
    const res = await rest("PATCH", `/rest/v1/${TABLE}`, {
      body: payload,
      query: `game_id=eq.${encodeURIComponent(String(gameId))}`
    });
    return normalize(Array.isArray(res) ? res[0] : res);
  }
}

async function deleteRow(gameId) {
  if (SB) {
    const { error } = await SB.from(TABLE).delete().eq("game_id", String(gameId));
    if (error) throw error;
  } else {
    await rest("DELETE", `/rest/v1/${TABLE}`, {
      query: `game_id=eq.${encodeURIComponent(String(gameId))}`
    });
  }
}

// ---------- public API used by combat.ui ----------
export const CombatStore = {
  async read(gameId) {
    console.log("[CombatStore.read]", gameId);
    return readRow(gameId);
  },

  onChange(gameId, cb) {
    console.log("[CombatStore.onChange] subscribe", gameId);
    if (SB) {
      // realtime via supabase-js
      const channel = SB
        .channel(`realtime:${TABLE}:${gameId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: TABLE, filter: `game_id=eq.${String(gameId)}` },
          (payload) => {
            const row = payload.new || payload.old || null;
            cb(normalize(row));
          }
        )
        .subscribe((status) => console.log("[CombatStore.onChange] status:", status));
      return () => SB.removeChannel(channel);
    } else {
      // REST polling fallback
      let stop = false;
      (async function tick(prevEpoch = 0) {
        while (!stop) {
          try {
            const row = await readRow(gameId);
            const nextEpoch = row?.epoch || 0;
            if (nextEpoch !== prevEpoch) {
              prevEpoch = nextEpoch;
              cb(row);
            }
          } catch (e) {
            console.warn("[CombatStore.onChange] poll error", e);
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      })();
      return () => { stop = true; };
    }
  },

async setInitiated(gameId, payloadOrSeat) {
  const base = { epoch: Date.now() };
  const patch = (typeof payloadOrSeat === "number")
    ? { ...base, attackingSeat: Number(payloadOrSeat) }
    : { ...base, ...(payloadOrSeat || {}) };
  console.log("[CombatStore.setInitiated]", { gameId, patch });
  return upsertRow(gameId, patch);
},


  async saveAttacks(gameId, attacksMap) {
 console.log("[CombatStore.saveAttacks]", { gameId, keys: Object.keys(attacksMap || {}) });
   // replace entirely to avoid race/merge confusion
   return upsertRow(gameId, {
     attacks: (attacksMap || {}),
     epoch: Date.now()
    });
  },

async saveBlocks(gameId, defenderSeat, blocksMap) {
  const seat = String(defenderSeat);
  console.log("[CombatStore.saveBlocks]", { gameId, seat, count: Object.keys(blocksMap || {}).length });
  const cur = (await readRow(gameId)) || {};
  const merged = { ...(cur.blocksByDefender || {}), [seat]: (blocksMap || {}) };
  return upsertRow(gameId, { blocksByDefender: merged, epoch: Date.now() });
},


  async write(gameId, patch) {
  console.log("[CombatStore.write]", { gameId, patch });
  // forward recommendedOutcome and applied as well as other fields
  return updateRow(gameId, {
    attackingSeat: patch.attackingSeat,
    attacks: patch.attacks,
    blocksByDefender: patch.blocksByDefender,
    recommendedOutcome: patch.recommendedOutcome,  // <--- add
    applied: patch.applied,                        // <--- add
    epoch: patch.epoch
  });
},


  async reset(gameId) {
    console.log("[CombatStore.reset]", gameId);
    return deleteRow(gameId);
  }
};

export default CombatStore;
