// Task 255 (wireframe 9): a Program's or field's lifecycle status as a pill.
// The words are the app's own status words (ACTIVE, DISCONTINUED, RETIRED),
// the same ones every Program Management screen already shows; the color
// only backs them up. textContent only.

export function lifecycleTone(status) {
  return status === 'ACTIVE' ? 'success' : 'neutral';
}

export function lifecyclePill(status) {
  const pill = document.createElement('span');
  pill.className = `pill pill--${lifecycleTone(status)}`;
  pill.textContent = status;
  return pill;
}
