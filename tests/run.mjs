import { JSDOM } from 'jsdom';
import { runOverlayTests } from './overlayEvents.browser.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'https://overlay-events.test/',
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.PointerEvent = window.PointerEvent || window.MouseEvent;

try {
  const result = await runOverlayTests();
  console.log(JSON.stringify(result, null, 2));
} finally {
  window.close();
}
