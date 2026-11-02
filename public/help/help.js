// Help and Guidance page (Task 225): only the text size is interactive.
// Nothing about anyone is shown or stored here; only the text size is
// remembered (Handoff PRD §33).

import { SIZES, loadSize, saveSize } from '/referral/textSize.js';

let storage;
try { storage = window.localStorage; } catch { storage = null; }

function resize(size) {
  document.documentElement.style.fontSize = `${SIZES[size]}px`;
  for (const button of document.querySelectorAll('[data-size]')) {
    button.setAttribute('aria-pressed', String(button.dataset.size === size));
  }
}

resize(loadSize(storage));
for (const button of document.querySelectorAll('[data-size]')) {
  button.addEventListener('click', () => {
    resize(button.dataset.size);
    saveSize(storage, button.dataset.size);
  });
}
