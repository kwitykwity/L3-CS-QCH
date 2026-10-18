const dot = document.getElementById('status-dot');
const text = document.getElementById('status-text');

function render(state, label) {
  dot.className = `dot dot--${state}`;
  text.textContent = label;
}

async function checkHealth() {
  try {
    const response = await fetch('/health', { cache: 'no-store' });

    if (!response.ok) {
      render('down', `unreachable (HTTP ${response.status})`);
      return;
    }

    const body = await response.json();
    render(body.status === 'ok' ? 'ok' : 'down', body.status ?? 'unknown');
  } catch {
    render('down', 'unreachable');
  }
}

checkHealth();
