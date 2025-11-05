// modules/utils.js
// Common utility helpers shared across the app
// Public API:
//   throttle(fn, ms)

/**
 * Throttle a function so that it only executes
 * at most once every `ms` milliseconds.
 * Useful for chatty UI events like drag + pan + move.
 */
export function throttle(fn, ms) {
  let t = 0;
  return (...args) => {
    const now = performance.now();
    if (now - t >= ms) {
      t = now;
      fn(...args);
    }
  };
}


export function newCid(){ return 'c_' + Math.random().toString(36).slice(2, 10); }
export function mySeat(){ return Number(window?.peer?.seat || 1); }

