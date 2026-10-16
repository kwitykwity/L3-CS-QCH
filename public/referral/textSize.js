// S / M / L / XL text size preference (PRD 14.5).
//
// - Default M (14px). Applies to labels, inputs, dropdowns, notes, errors
//   and controls through rem-based CSS.
// - Changing size only changes the root font size, so active work in the
//   form is untouched. Browser zoom keeps working.
// - The preference is non-sensitive and may persist (PRD 5.5). Storage can
//   be unavailable (private mode, blocked site data), so every access is
//   wrapped and the page works without it.

export const SIZES = Object.freeze({ S: 12, M: 14, L: 18, XL: 24 });
export const DEFAULT_SIZE = 'M';
const STORAGE_KEY = 'qchConnect.textSize';

export function normalizeSize(value) {
  return Object.hasOwn(SIZES, value) ? value : DEFAULT_SIZE;
}

export function loadSize(storage) {
  try {
    return normalizeSize(storage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SIZE;
  }
}

export function saveSize(storage, size) {
  try {
    storage?.setItem(STORAGE_KEY, normalizeSize(size));
  } catch {
    // Not saved this time; the chosen size still applies on this page.
  }
}
