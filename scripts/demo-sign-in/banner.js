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
  // Wireframe look (Task 248): a quiet strip with a dashed outlined tag, so
  // the demo label stays clear without a bright bar over every page. Words
  // carry the meaning; colors are 7:1 or more in both themes.
  style.textContent = `
    .demo-bar { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; justify-content: space-between; padding: 6px 16px; background: #ffffff; color: #1a1d21; border-bottom: 1px solid #dde1e6; font: 14px/1.4 system-ui, sans-serif; }
    .demo-bar__tag { padding: 2px 8px; border: 1px dashed #8a3a00; border-radius: 4px; color: #8a3a00; font-weight: 600; }
    .demo-bar a { color: #1d5bb8; }
    .demo-bar a:focus-visible { outline: 3px solid #1a1d21; outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      .demo-bar { background: #1e2227; color: #e8eaed; border-bottom-color: #47505a; }
      .demo-bar__tag { border-color: #f0c36d; color: #f0c36d; }
      .demo-bar a { color: #8fb4f2; }
      .demo-bar a:focus-visible { outline-color: #e8eaed; }
    }`;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Demo sign-in');
  const label = document.createElement('span');
  label.textContent = 'Demo sign-in. Production uses QCH Microsoft sign-in.';
  label.className = 'demo-bar__tag';
  const who = document.createElement('span');
  who.append(document.createTextNode(current ? `Signed in as ${current.name} ` : 'Not signed in '));
  const link = document.createElement('a');
  link.href = '/demo/';
  link.textContent = 'Switch person';
  who.append(link);
  bar.append(label, who);
  document.body.prepend(bar);
  // Keep the banner in normal flow: wrapping and focus/anchor scrolling must
  // not leave content behind a fixed overlay (issue #102, Task 241).
})();
