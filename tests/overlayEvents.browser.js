import { createOverlayRouter } from '../overlayEvents.js';
const wait = () => new Promise(r => setTimeout(r, 40));
const assert = (ok, text) => { if (!ok) throw Error(text); };

export async function runOverlayTests(migrations = []) {
  const results = [];
  let claims = 0;
  const escClaim = { acquire: () => { claims++; return () => claims--; } };
  const router = createOverlayRouter(document, escClaim);
  const fixture = document.createElement('div');
  fixture.innerHTML = '<div id="owner" style="height:60px;overflow:auto"><div style="height:600px"><button id="anchor">anchor</button></div></div><div id="sibling" style="height:60px;overflow:auto"><div style="height:600px">chat</div></div><div id="overlay" style="height:60px;overflow:auto"><div style="height:600px">menu</div></div>';
  document.body.append(fixture);
  const owner = fixture.querySelector('#owner'), anchor = fixture.querySelector('#anchor'), sibling = fixture.querySelector('#sibling'), overlay = fixture.querySelector('#overlay');
  const scroll = async node => {
    node.scrollTop = node.scrollTop === 0 ? 20 : 0;
    // Browsers emit this after a real scroll; dispatch explicitly so the same
    // contract is deterministic in jsdom's layout-free environment.
    node.dispatchEvent(new Event('scroll'));
    await wait();
  };
  const key = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const pointer = node => node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  const closes = [];
  let options = { ownerId: 'contract', anchor, overlay, onClose: d => closes.push(d) };
  let release = router.register(() => options);
  await scroll(sibling); assert(!closes.length, 'sibling scroll closed');
  await scroll(overlay); assert(!closes.length, 'internal scroll closed');
  pointer(overlay.firstChild); assert(!closes.length, 'portal inside closed');
  await scroll(owner); assert(closes.at(-1)?.closeReason === 'owner-scroll', 'owner scroll not closed');
  release(); results.push('scroll scope/internal portal');
  closes.length = 0;
  let repositioned = 0;
  options = { ...options, scroll: 'reposition', viewport: 'reposition', onReposition: () => repositioned++ };
  release = router.register(() => options);
  await scroll(owner); window.dispatchEvent(new Event('resize')); document.dispatchEvent(new Event('scroll')); await wait();
  assert(repositioned === 3 && !closes.length, 'reposition policy');
  release(); results.push('owner/root viewport reposition');
  options = { ...options, scroll: 'close', viewport: 'close' };
  release = router.register(() => options); window.dispatchEvent(new Event('resize'));
  assert(closes.at(-1)?.closeReason === 'viewport-change', 'resize close'); release(); closes.length = 0;
  let lower = 0, upper = 0;
  const releaseLower = router.register(() => ({ ...options, onClose: () => lower++ }));
  const releaseUpper = router.register(() => ({ ...options, onClose: () => upper++ }));
  key(); assert(upper === 1 && lower === 0, 'escape closes more than top');
  releaseUpper(); pointer(sibling); assert(lower === 1, 'outside pointer'); releaseLower();
  results.push('top escape/outside pointer');
  lower = 0; upper = 0;
  const nestedAnchor = document.createElement('button'); overlay.append(nestedAnchor);
  const childPanel = document.createElement('div'); document.body.append(childPanel);
  const nestedOff = router.register(() => ({ ...options, anchor: nestedAnchor, overlay: childPanel, onClose: () => upper++ }));
  const parentOff = router.register(() => ({ ...options, onClose: () => lower++ }));
  key(); assert(upper === 1 && lower === 0, 'child-first effect ordering');
  nestedOff(); parentOff(); nestedAnchor.remove(); childPanel.remove();
  results.push('nested portal child-first registration');
  const shadowHost = document.createElement('div'); overlay.append(shadowHost);
  const shadow = shadowHost.attachShadow({ mode: 'open' }); shadow.innerHTML = '<button>shadow portal child</button>';
  release = router.register(() => options); pointer(shadow.firstChild); assert(!closes.length, 'composedPath shadow inside'); release();
  results.push('composedPath shadow');
  let currentCallback = 0;
  release = router.register(() => options);
  options = { ...options, onClose: () => currentCallback++ }; key();
  assert(currentCallback === 1, 'stale callback'); release(); results.push('fresh callback without register');
  options = { ...options, onClose: d => closes.push(d) };
  release = router.register(() => options); anchor.remove(); await wait();
  assert(closes.at(-1)?.closeReason === 'anchor-removed', 'removed anchor'); release(); owner.firstChild.append(anchor); closes.length = 0;
  release = router.register(() => options); owner.hidden = true; await wait();
  assert(closes.at(-1)?.closeReason === 'owner-inactive', 'hidden owner'); release(); owner.hidden = false; closes.length = 0;
  results.push('removed anchor/inactive owner');
  const nextAnchor = document.createElement('button'); owner.firstChild.append(nextAnchor);
  release = router.register(() => options); options = { ...options, anchor: nextAnchor };
  anchor.remove(); await wait(); assert(!closes.length, 'old anchor removal closed new anchor');
  nextAnchor.remove(); await wait(); assert(closes.at(-1)?.closeReason === 'anchor-removed', 'new anchor removal');
  release(); owner.firstChild.append(anchor); options = { ...options, anchor }; closes.length = 0;
  results.push('anchor changes without stale ownership');
  release = router.register(() => ({ ...options, anchor: null, ownerScope: owner }));
  await scroll(sibling); assert(!closes.length, 'selection sibling'); await scroll(owner);
  assert(closes.length === 1, 'selection owner'); release(); results.push('selection local owner');
  const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true'); modal.textContent = 'legacy modal';
  // jsdom has no layout, so mark this fixture visible explicitly.
  modal.getClientRects = () => [{ width: 1, height: 1 }];
  document.body.append(modal);
  closes.length = 0; release = router.register(() => options); key(); assert(!closes.length, 'underlying popup stole modal Escape'); release(); modal.remove();
  results.push('unmanaged modal precedence');
  const migrationResults = [];
  for (const item of migrations) {
    const events = [];
    const scope = new Proxy({}, { has: () => true, get(_t, name) {
      if (name === Symbol.unscopables) return undefined;
      if (String(name).startsWith('set') || name === 'close') return () => events.push('close');
      if (name === 'ownerScope') return { current: owner };
      if ((/overlay|ctxMenuRef/i.test(String(name)) || (name === 'elRef' && item.file.includes('SelectionFloatMenu')))) return { current: overlay };
      if (/Ref$/.test(String(name))) return { current: anchor };
      return { anchor };
    }});
    const migrated = Function('scope', `with(scope){return (${item.options})}`)(scope);
    const register = () => router.register(() => ({ ...migrated, onDiagnostic: d => events.push(d.closeReason) }));
    let off = register(); await scroll(sibling); const unrelatedClosed = events.length;
    await scroll(overlay); const internalClosed = events.length; await scroll(owner);
    const localClosed = events.includes('owner-scroll'); off(); events.length = 0;
    off = register(); key(); const escapeClosed = events.includes('escape'); off(); events.length = 0;
    off = register(); pointer(sibling); const outsideClosed = events.includes('outside-pointer'); off();
    assert(!unrelatedClosed && !internalClosed && localClosed && escapeClosed && outsideClosed, 'migration '+item.file+':'+item.line);
    migrationResults.push({ file: item.file, line: item.line, unrelatedClosed, internalClosed, localClosed, escapeClosed, outsideClosed });
  }
  assert(claims === 0, 'Esc claim leak'); fixture.remove();
  return { contracts: results, migrations: migrationResults, claims };
}
