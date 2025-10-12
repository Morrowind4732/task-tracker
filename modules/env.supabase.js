// modules/env.supabase.js
// Loads @supabase/supabase-js, exposes window.SUPABASE (client)
// and window.SUPABASE_READY (awaitable promise). Includes clear health logs.

(function () {
  const TAG = '[ENV/SUPABASE]';

  // Avoid double-boot
  if (window.SUPABASE_READY) {
    console.log(TAG, 'already initialized; reusing existing SUPABASE_READY promise');
    return;
  }

  const must = (k) => {
    const fromGlobals =
      (window.SB_URL ?? '') && (window.SB_ANON_KEY ?? '') ? window[k] : '';
    // ✅ use import.meta (not `import`) in the typeof guard
    const fromVite =
      (typeof import.meta !== 'undefined' && import.meta?.env)
        ? (import.meta.env[k] ?? '')
        : '';
    return fromGlobals || fromVite || '';
  };

  // ── 🔧 EDIT ME (search: SUPABASE_KEYS) ───────────────────────────────────────
  // SUPABASE_KEYS
  if (!('SB_URL' in window))      window.SB_URL      = 'https://uvrnxrmwoyhswzldhcul.supabase.co';
  if (!('SB_ANON_KEY' in window)) window.SB_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2cm54cm13b3loc3d6bGRoY3VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk4NDgyMDgsImV4cCI6MjA3NTQyNDIwOH0.vOefq7j90s4IF951U1P2-69xhLb5Z5rvdAZ875A1cXo';
  // ─────────────────────────────────────────────────────────────────────────────

  const url = must('SB_URL') || window.SB_URL;
  const key = must('SB_ANON_KEY') || window.SB_ANON_KEY;

  async function ensureLib() {
    if (window.supabase?.createClient) return window.supabase;
    console.log(TAG, 'loading @supabase/supabase-js…');
    const m = await import('https://esm.sh/@supabase/supabase-js@2?bundle');
    window.supabase ??= m;
    return window.supabase;
  }

  // Build the ready promise up-front so others can await it immediately
  window.SUPABASE_READY = (async () => {
    try {
      if (!url || !key) {
        const err = new Error('Missing SB_URL / SB_ANON_KEY. Edit env.supabase.js (SUPABASE_KEYS section).');
        console.error(TAG, '❌', err.message);
        throw err;
      }

      const supabase = await ensureLib();
      const { createClient } = supabase;

      const client = createClient(url, key, {
        realtime: { params: { eventsPerSecond: 20 } },
      });

      // expose the client immediately
      window.SUPABASE = client;
      console.log(TAG, '✅ client ready for', url);

      // quick realtime ping to confirm reachability
      try {
        const ch = client.channel('ping_env_check', { config: { broadcast: { self: true } } });
        const pong = new Promise((resolve) => {
          ch.on('broadcast', { event: 'pong' }, () => {
            console.log(TAG, '✅ realtime pong received — Realtime reachable');
            resolve();
            ch.unsubscribe();
          });
        });
        await new Promise((subscribed) => {
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              console.log(TAG, 'realtime SUBSCRIBED (env check)');
              ch.send({ type: 'broadcast', event: 'pong', payload: { ts: Date.now() } });
              subscribed();
            }
          });
        });
        await pong;
      } catch (e) {
        console.warn(TAG, 'realtime ping skipped/failed (non-fatal):', e?.message || e);
      }

      return client;
    } catch (e) {
      console.error(TAG, '❌ init failed:', e);
      throw e;
    }
  })();
})();
