# overlay-events

`overlay-events` is a small React/DOM event router for layered UI such as menus,
tooltips, and popovers. It centralizes outside-pointer, Escape, scroll, viewport,
and anchor-lifecycle handling while ensuring that only the topmost overlay reacts.

## Host integration

Shared source code imports the virtual module name `@shared/overlay-events`.
Applications provide it through their bundler alias and point that alias at this
repository's `overlayEvents.js` checkout, normally via a Git submodule. This
repository is source-consumed; it is not currently published to npm.

Every rendered page must load exactly one module instance. Multiple physical
copies create independent router stacks and can cause more than one overlay to
handle the same event.

```js
import { createOverlayRouter, useOverlayEvents } from '@shared/overlay-events';

const release = createOverlayRouter(document, escClaim).register(() => options);
useOverlayEvents({ active: true, anchor, overlay, onClose }, escClaim);
```

Both exports accept an optional `escClaim` object with an `acquire()` method.
`acquire()` may return a release callback. When no object is injected, the router
uses `document.defaultView.__overlayEscClaim` if present. This lets a host
coordinate Escape ownership without making the shared implementation depend on
host naming.

Set `window.__overlayEventsDebug = true` to dispatch diagnostic
`overlay-events:dismiss` events. Diagnostics contain owner/reason/DOM labels, not
application content.

## Development

Use Node.js 20 or newer:

```sh
npm install
npm test
npm run check
```

The browser contract suite runs under jsdom and covers routing, nested overlays,
scroll and viewport policies, anchor lifecycle, modal precedence, and Esc claim
release.

## License

MIT © Xenotech-Studio.
