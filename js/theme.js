(() => {
  const themes = ['midnight', 'aurora', 'classic'];
  let active = document.documentElement.dataset.theme || 'midnight';
  if (!themes.includes(active)) active = 'midnight';
  const labelKey = { midnight: 'themeMidnight', aurora: 'themeAurora', classic: 'themeClassic' };
  function paint() {
    document.documentElement.dataset.theme = active;
    try { localStorage.setItem('playuno_theme', active); } catch {}
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const label = window.PlayUnoI18n?.t(labelKey[active]) || active;
      const prefix = window.PlayUnoI18n?.t('changeTheme') || 'Change theme';
      const name = button.querySelector('[data-theme-name]');
      if (name) name.textContent = label;
      button.title = `${prefix}: ${label}`;
      button.setAttribute('aria-label', `${prefix}: ${label}`);
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => button.addEventListener('click', () => {
      active = themes[(themes.indexOf(active) + 1) % themes.length];
      paint();
    }));
    paint();
  });
  document.addEventListener('playuno:language', paint);
})();
