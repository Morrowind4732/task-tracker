// modules/combat.store.js
// Firestore wrapper for the combat flow.
// Single doc: games/{gameId}/combat/current

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,          // <-- added
  onSnapshot,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Build the document ref lazily (after Firebase app is initialized elsewhere)
function combatDoc(gameId) {
  return doc(getFirestore(), "games", String(gameId), "combat", "current");
}

export const CombatStore = {
  // Read the current combat doc (null if missing)
  async read(gameId) {
    const snap = await getDoc(combatDoc(gameId));
    return snap.exists() ? snap.data() : null;
  },

  // Subscribe to changes. Returns unsubscribe()
  onChange(gameId, cb) {
    return onSnapshot(combatDoc(gameId), (snap) => {
      cb(snap.exists() ? snap.data() : null);
    });
  },

  // Do NOT include attacks/blocks here (prevents clobbering after saveAttacks)
  // Accepts either the attacker's seat number or a payload object to merge.
  async setInitiated(gameId, payloadOrSeat) {
    const base = {
      phase: "choose-defender",
      attacker: 0,
      defender: 0,
      result: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      combatInitiated: 1
    };

    const payload =
      typeof payloadOrSeat === "number"
        ? { attackerSeat: Number(payloadOrSeat), attackingSeat: Number(payloadOrSeat) }
        : (payloadOrSeat || {});

    await setDoc(combatDoc(gameId), { ...base, ...payload }, { merge: true });
  }, // <-- the missing comma

  // Deep-merge only this defender's blocks
  // blocksForSeat shape: { [attackerCid]: [blockerCid, ...] }
  async saveBlocks(gameId, defenderSeat, blocksForSeat) {
    const ref = combatDoc(gameId);
    await updateDoc(ref, {
      [`blocksByDefender.${defenderSeat}`]: blocksForSeat,
      updatedAt: serverTimestamp()
    }).catch(async () => {
      // If doc doesn't exist yet, fall back to merge set
      await setDoc(ref, {
        blocksByDefender: { [defenderSeat]: blocksForSeat },
        updatedAt: serverTimestamp()
      }, { merge: true });
    });
  },

  // Save attacker assignments (object map)
  async saveAttacks(gameId, attacks) {
    await setDoc(
      combatDoc(gameId),
      { attacks, updatedAt: serverTimestamp() },
      { merge: true }
    );
  },

  // Generic merge write
  async write(gameId, updates) {
    await setDoc(
      combatDoc(gameId),
      { ...updates, updatedAt: serverTimestamp() },
      { merge: true }
    );
  },

  // Clear the combat doc
  async reset(gameId) {
    try {
      await deleteDoc(combatDoc(gameId));
    } catch (_) {
      // ignore if it doesn't exist
    }
  }
};

export default CombatStore;
