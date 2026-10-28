// Demo sign-in page: lists the synthetic people and signs in as the chosen one.
const list = document.getElementById('people');
const message = document.getElementById('message');

function show(text, isError) {
  message.textContent = text;
  message.className = isError ? 'error' : '';
}

async function signIn(person) {
  show('Signing in ...');
  try {
    const res = await fetch('/demo/api/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person: person.key }),
    });
    if (!res.ok) throw new Error('failed');
    window.location.assign(person.landing);
  } catch {
    show('Could not sign in as this person. Try again.', true);
  }
}

try {
  const res = await fetch('/demo/api/people');
  const { people, current } = await res.json();
  for (const person of people) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'person';
    if (current && current.key === person.key) button.setAttribute('aria-current', 'true');
    const name = document.createElement('span');
    name.className = 'person__name';
    name.textContent = current && current.key === person.key ? `${person.name} (signed in now)` : person.name;
    const what = document.createElement('span');
    what.className = 'person__what';
    what.textContent = person.description;
    button.append(name, what);
    button.addEventListener('click', () => signIn(person));
    list.append(button);
  }
} catch {
  show('Could not load the demo people. Reload the page.', true);
}
