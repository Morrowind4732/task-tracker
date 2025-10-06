// modules/combat.store.js
import {
  readCombat, writeCombat, resetCombat,
  writeCombatInitiated, clearCombatInitiated,
  saveAttacks, saveBlocks, saveOutcome,
} from './storage.js';

export const CombatStore = {
  read: readCombat,
  write: writeCombat,
  reset: resetCombat,
  setInitiated: writeCombatInitiated,
  clearInitiated: clearCombatInitiated,
  saveAttacks,
  saveBlocks,
  saveOutcome,
};
