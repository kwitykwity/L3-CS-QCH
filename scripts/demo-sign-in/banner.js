// Added to every app page by the demo server (never by production): says this
// is the demo sign-in, who is signed in, and lets the presenter switch person.
(async () => {
  let current = null;
  try {
    const res = await fetch('/demo/api/people');
    ({ current } = await res.json());
  } catch {
    // Show the label even if the lookup fails.
  }

  const style = document.createElement('style');
  style.textContent = `
    .demo-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 1000; display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; justify-content: space-between; padding: 6px 16px; background: #fff3cd; color: #1a1d21; border-bottom: 2px solid #7a5b00; font: 600 14px/1.4 system-ui, sans-serif; }
    .demo-bar a { color: #1f3a78; }
    .demo-bar a:focus-visible { outline: 3px solid #1a1d21; outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      .demo-bar { background: #3b2f00; color: #fff3cd; border-bottom-color: #fff3cd; }
      .demo-bar a { color: #cfe0ff; }
      .demo-bar a:focus-visible { outline-color: #fff3cd; }
    }`;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Demo sign-in');
  const label = document.createElement('span');
  label.textContent = 'Demo sign-in. Production uses QCH Microsoft sign-in.';
  const who = document.createElement('span');
  who.append(document.createTextNode(current ? `Signed in as ${current.name} ` : 'Not signed in '));
  const link = document.createElement('a');
  link.href = '/demo/';
  link.textContent = 'Switch person';
  who.append(link);
  bar.append(label, who);
  document.body.prepend(bar);
  document.documentElement.style.paddingTop = `${bar.offsetHeight}px`;
})();
