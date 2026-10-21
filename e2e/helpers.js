// Shared helpers for the card 17 browser tests. SYNTHETIC data only.

import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The team target is WCAG 2.2 AA (PRD 14.1).
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Runs axe on the page as it is now and fails with a readable list.
export async function expectNoAxeViolations(page, label) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, `axe violations: ${label}`).toEqual([]);
}

// What has keyboard focus: its id, or name, or tag.
export function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el?.id || el?.getAttribute('name') || el?.tagName.toLowerCase() || null;
  });
}

// Presses Tab (or Shift+Tab) until `target` has focus. Fails if it is not
// reached: that control cannot be reached by keyboard (PRD 14.2).
export async function tabTo(page, target, { back = false, max = 80 } = {}) {
  for (let i = 0; i < max; i += 1) {
    if ((await focused(page)) === target) return;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`could not reach #${target} by keyboard`);
}

// The focus treatment the PRD asks for: a visible outline (not color
// alone) on whatever has focus (PRD 14.2).
export function focusStyle(page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), background: style.backgroundColor };
  });
}

// The synthetic dev server has one developer identity, so the
// affiliation may already be set by an earlier test. Make sure it is.
export async function ensureAffiliation(page, programId = 1) {
  await page.evaluate(async (id) => {
    const current = await (await fetch('/api/me/affiliation')).json();
    if (current.status === 'SET' && current.program?.programId === id) return;
    await fetch('/api/me/affiliation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ programId: id, version: current.version }),
    });
  }, programId);
}

// The New Referral page opens on a choice between guided matching and
// Direct Referral, with neither preselected (card 11, PRD 2.1). Tests that
// are not about that choice use this to pick Direct Referral.
export async function chooseDirect(page) {
  await page.locator('#path-direct').click();
  await expect(page.locator('#direct')).toBeVisible();
}

