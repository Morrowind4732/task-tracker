// modules/notification.js
// Zoom‑Pop + Shockwave notification module
// Usage (ESM):
//   import { Notification } from './notification.js';
//   Notification.show({ top: 'COMBAT', bottom: 'INITIATED' });
//   Notification.show({ top: 'PLAYER 1', bottom: 'YOUR TURN', accent: '#ff3b3b' });

export const Notification = (() => {
  const STYLE_ID = 'notif-zoom-style-v1';
  const HOST_ID  = 'notif-zoom-host-v1';

  function ensureStyles(){
    if (document.getElementById(STYLE_ID)) return;
    const css = `:root{--notif-bg: transparent; --notif-fg:#fff; --notif-accent:#36e1ff; --notif-shadow:rgba(0,0,0,.45)}
#${HOST_ID}{position:fixed; inset:0; pointer-events:none; z-index:999999; display:grid; place-items:center;}
#${HOST_ID}.hidden{display:none}
#${HOST_ID} .wrap{position:relative; display:grid; place-items:center; padding:6vmin;}
#${HOST_ID} .zoom{position:relative; text-align:center; font-weight:1000; letter-spacing:.08em; line-height:1.02; color:var(--notif-fg);}
#${HOST_ID} .row{display:block; white-space:nowrap;}
#${HOST_ID} .row.top{font-size:min(12vw, 100px)}
#${HOST_ID} .row.bottom{font-size:min(10vw, 84px)}
#${HOST_ID} .accent{color:var(--notif-accent)}
#${HOST_ID} .shadow{filter: drop-shadow(0 12px 28px var(--notif-shadow));}
/* shockwave ring */
#${HOST_ID} .zoom::after{content:''; position:absolute; left:50%; top:50%; width:0; height:0; border-radius:999px; border:6px solid var(--notif-accent); opacity:0; transform:translate(-50%,-50%) scale(1)}
/* animation toggles */
#${HOST_ID} .zoom.animate{animation: notif-zoom-pop 620ms cubic-bezier(.2,.8,.2,1) both}
#${HOST_ID} .zoom.animate::after{animation: notif-shock 700ms ease-out 280ms 1 forwards}
#${HOST_ID} .fade-in{animation: notif-fade .25s ease-out both}
/* optional backdrop glow (off by default) */
#${HOST_ID} .backdrop{position:absolute; inset:0; background:var(--notif-bg); opacity:0;}
#${HOST_ID} .backdrop.show{animation: notif-fade .2s ease-out forwards}
@keyframes notif-zoom-pop{0%{transform:scale(.2); opacity:0}60%{transform:scale(1.12); opacity:1}100%{transform:scale(1)}}
@keyframes notif-shock{0%{opacity:.95; width:0; height:0} 100%{opacity:0; width:180%; height:180%; transform:translate(-50%,-50%) scale(1)}}
@keyframes notif-fade{from{opacity:0} to{opacity:1}}
`;
    const style = document.createElement('style');
    style.id = STYLE_ID; style.textContent = css; document.head.appendChild(style);
  }

  function ensureHost(){
    let host = document.getElementById(HOST_ID);
    if (!host){
      host = document.createElement('div');
      host.id = HOST_ID; host.className = 'hidden';
      document.body.appendChild(host);
    }
    return host;
  }

  function clearHost(){
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    host.innerHTML = '';
  }

  /**
   * Show a zoom‑pop + shockwave notification.
   * @param {Object} opts
   * @param {string} opts.top    - Top row text (e.g., "COMBAT")
   * @param {string} opts.bottom - Bottom row text (e.g., "INITIATED" or "YOUR TURN")
   * @param {number} [opts.duration=1600] - Total lifetime before auto remove (ms)
   * @param {string} [opts.accent]  - Accent color for emphasis / ring
   * @param {string} [opts.color]   - Foreground text color
   * @param {string} [opts.backdrop] - Optional rgba() to dim background; falsy disables
   * @param {boolean} [opts.keep=false] - If true, do not auto-remove; caller must dismiss()
   * @returns {Promise<void>} resolves when removed (auto or manual)
   */
  function show(opts){
    const {
      top = '', bottom = '', duration = 1600,
      accent, color, backdrop, keep = false
    } = (opts||{});

    ensureStyles();
    const host = ensureHost();
    clearHost();

    // root wrapper
    const wrap = document.createElement('div');
    wrap.className = 'wrap fade-in';

    // backdrop (optional)
    if (backdrop){
      const bd = document.createElement('div');
      bd.className = 'backdrop show';
      wrap.appendChild(bd);
      wrap.style.setProperty('--notif-bg', backdrop);
    }

    // text block
    const block = document.createElement('div');
    block.className = 'zoom shadow';

    const rowTop = document.createElement('span');
    rowTop.className = 'row top';
    rowTop.textContent = String(top||'').toUpperCase();

    const rowBottom = document.createElement('span');
    rowBottom.className = 'row bottom accent';
    rowBottom.textContent = String(bottom||'').toUpperCase();

    block.append(rowTop, rowBottom);
    wrap.appendChild(block);
    host.appendChild(wrap);

    // theming
    if (accent) host.style.setProperty('--notif-accent', accent);
    if (color)  host.style.setProperty('--notif-fg', color);

    host.classList.remove('hidden');

    // trigger animations (allow layout)
    queueMicrotask(()=> block.classList.add('animate'));

    // auto-remove / manual control
    let resolvePromise;
    const done = new Promise(r=> (resolvePromise=r));

    function remove(){
      if (!host.contains(wrap)) return; // already removed
      try { block.classList.remove('animate'); } catch {}
      // soft fade out
      wrap.style.transition = 'opacity 260ms ease';
      wrap.style.opacity = '0';
      setTimeout(()=>{
        if (host.contains(wrap)) host.removeChild(wrap);
        // hide host if empty
        if (!host.firstChild) host.classList.add('hidden');
        resolvePromise();
      }, 260);
    }

    if (!keep){ setTimeout(remove, Math.max(600, duration)); }

    // Return a small handle too
    const handle = { remove, done };
    return handle;
  }

  return { show };
})();
