const tabs = document.querySelectorAll('[role="tab"]');
const panels = document.querySelectorAll('[role="tabpanel"]');
const hash = window.location.hash;

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.getAttribute('aria-controls');
    panels.forEach(p => p.hidden = p.id !== target);
    tabs.forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      if (selected) {
        t.className = 'rounded-lg px-4 py-1.5 text-xs font-bold bg-primary text-primary-foreground shadow-sm';
      } else {
        t.className = 'rounded-lg px-4 py-1.5 text-xs font-semibold text-muted-foreground';
      }
    });
    window.history.replaceState(null, '', `#${tab.getAttribute('data-tab')}`);
  });
});

if (hash === '#pipeline') {
  document.querySelector('[data-tab="pipeline"]')?.dispatchEvent(new Event('click'));
}
