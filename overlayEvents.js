import { useEffect, useLayoutEffect, useRef } from 'react';

// 一个 Document 一个事件路由；只保存打开顺序和 DOM 所属关系，不保存组件菜单状态。
const routers = new WeakMap();
const resolve = value => typeof value === 'function' ? value() : value?.current ?? value;
const within = (node, target) => !!node && (node === target || (target?.nodeType && node.contains?.(target)));
const describe = node => node?.nodeType === 9 ? 'document' : node?.tagName ? `${node.tagName.toLowerCase()}${node.id ? '#'+node.id : ''}` : 'viewport';

export function createOverlayRouter(doc, escClaim) {
  const win = doc.defaultView;
  const stack = [];
  let observer, frame = 0;
  const top = () => {
    let current = stack.at(-1);
    const visited = new Set();
    // 同一提交中 React 的子 effect 先注册：用 DOM 所属关系优先于注册顺序。
    while (current && !visited.has(current)) {
      visited.add(current);
      const panel = resolve(current.read().overlay);
      const child = [...stack].reverse().find(entry => entry !== current && !visited.has(entry) &&
        within(panel, resolve(entry.read().anchor) || resolve(entry.read().ownerScope)));
      if (!child) break;
      current = child;
    }
    return current;
  };
  function finish(entry, closeReason, event) {
    if (entry.closed) return;
    entry.closed = true;
    const options = entry.read();
    const detail = { ownerId: options.ownerId, closeReason, sourceTarget: describe(event?.target), at: Date.now() };
    options.onDiagnostic?.(detail);
    // 显式开启才发诊断事件，不保留 DOM/聊天内容，也不无限累积历史。
    if (win.__overlayEventsDebug) win.dispatchEvent(new win.CustomEvent('overlay-events:dismiss', { detail }));
    options.onClose?.(detail);
  }
  function inside(entry, event) {
    const o = entry.read(), path = event.composedPath?.() || [event.target];
    return [o.overlay, o.anchor, ...(o.inside || [])].map(resolve).some(node => path.some(target => within(node, target)));
  }
  function hasForeignModal(entry) {
    const o = entry.read();
    return [...doc.querySelectorAll('[aria-modal="true"]')].some(modal =>
      modal.getClientRects().length && !within(modal, resolve(o.anchor)) && !within(modal, resolve(o.overlay)) && !within(modal, resolve(o.ownerScope)));
  }
  function pointer(event) {
    const entry = top();
    if (!entry || entry.closed || entry.read().outsidePointer === false || inside(entry, event) || hasForeignModal(entry)) return;
    finish(entry, 'outside-pointer', event);
  }
  function key(event) {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    const entry = top();
    if (!entry || hasForeignModal(entry)) return;
    // 同一个按键只处理栈顶；阻断旧的冒泡 Esc 监听与宿主快捷键。
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) finish(entry, 'escape', event);
  }
  function move(event) {
    const viewport = event.type === 'resize' || event.target === win || event.target === doc || event.target === doc.documentElement || event.target === doc.body || event.target === win.visualViewport;
    for (const entry of [...stack]) {
      if (entry.closed) continue;
      const o = entry.read(), anchor = resolve(o.anchor), owner = resolve(o.ownerScope), panel = resolve(o.overlay);
      if (!viewport && within(panel, event.target)) continue;
      // anchor 的祖先滚动才影响坐标；没有 DOM anchor 的选区菜单使用局部 owner。
      const relevant = viewport || (anchor ? within(event.target, anchor) : owner && (within(owner, event.target) || within(event.target, owner)));
      if (!relevant) continue;
      const policy = viewport ? (o.viewport || o.scroll || 'close') : (o.scroll || 'close');
      if (policy === 'reposition') o.onReposition?.(event);
      else if (policy === 'close') finish(entry, viewport ? 'viewport-change' : 'owner-scroll', event);
    }
  }
  function checkAnchors() {
    frame = 0;
    for (const entry of [...stack]) {
      const o = entry.read(), anchor = resolve(o.anchor) || resolve(o.ownerScope);
      if (anchor) entry.initialAnchor = anchor;
      if ((entry.initialAnchor && !entry.initialAnchor.isConnected) || (anchor && !anchor.isConnected)) finish(entry, 'anchor-removed');
      else if (anchor) {
        for (let parent = anchor; parent?.nodeType === 1; parent = parent.parentElement) {
          if (parent.matches('[hidden], [inert], [aria-hidden="true"]') || win.getComputedStyle(parent).display === 'none') { finish(entry, 'owner-inactive'); break; }
        }
      }
    }
  }
  const observe = records => {
    const relevant = stack.some(entry => {
      const o = entry.read(), anchor = resolve(o.anchor) || resolve(o.ownerScope);
      return records.some(record => record.type === 'attributes' ? within(record.target, anchor) : [...record.removedNodes].some(node => within(node, entry.initialAnchor) || within(node, anchor)));
    });
    if (relevant && !frame) frame = win.requestAnimationFrame(checkAnchors);
  };
  function attach() {
    win.addEventListener('pointerdown', pointer, true);
    win.addEventListener('keydown', key, true);
    win.addEventListener('scroll', move, true);
    win.addEventListener('resize', move);
    win.visualViewport?.addEventListener('scroll', move);
    win.visualViewport?.addEventListener('resize', move);
    observer = new win.MutationObserver(observe);
    observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'style', 'class'] });
  }
  function detach() {
    win.removeEventListener('pointerdown', pointer, true);
    win.removeEventListener('keydown', key, true);
    win.removeEventListener('scroll', move, true);
    win.removeEventListener('resize', move);
    win.visualViewport?.removeEventListener('scroll', move);
    win.visualViewport?.removeEventListener('resize', move);
    observer?.disconnect();
    win.cancelAnimationFrame(frame);
    frame = 0;
  }
  return {
    register(read, registrationEscClaim = escClaim) {
      const o = read();
      const owner = resolve(o.ownerScope);
      if ([doc, doc.body, doc.documentElement].includes(owner)) throw new Error('overlay ownerScope must be local');
      const entry = { read, closed: false, initialAnchor: resolve(o.anchor) || resolve(o.ownerScope) };
      if (!stack.length) attach();
      stack.push(entry);
      if (!frame) frame = win.requestAnimationFrame(checkAnchors);
      const release = (registrationEscClaim ?? win.__overlayEscClaim)?.acquire?.();
      return () => {
        const index = stack.indexOf(entry);
        if (index < 0) return;
        stack.splice(index, 1);
        release?.();
        if (!stack.length) detach();
      };
    },
  };
}

/**
 * DOM/ref/getter 均可。ownerScope 必须是局部交互区域，禁止 document/body/应用根。
 * scroll/viewport: close | reposition | ignore。onClose 保留在调用方的局部 state。
 * inside: 跨 portal 的附属节点。active=false 时自动释放路由与 Esc claim。
 * escClaim 可选；未注入时回退到 document.defaultView.__overlayEscClaim。
 */
export function useOverlayEvents(options, escClaim) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    if (!options.active) return undefined;
    const node = resolve(options.anchor) || resolve(options.ownerScope) || resolve(options.overlay);
    const doc = node?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return undefined;
    let router = routers.get(doc);
    if (!router) { router = createOverlayRouter(doc); routers.set(doc, router); }
    return router.register(() => latest.current, escClaim);
  }, [options.active, escClaim]);
}
