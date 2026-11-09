// TUNOTOGETHER.COM configuration — Supports Vercel (/api/rooms), Node.js, and PHP
(function () {
  function resolveBases() {
    let siteBase = '';
    try {
      const path = window.location.pathname || '/';
      if (/\/room(\/|$)/i.test(path)) {
        siteBase = new URL('..', window.location.href).href.replace(/\/$/, '');
      } else {
        siteBase = new URL('.', window.location.href).href.replace(/\/$/, '');
      }
    } catch (_) {
      siteBase = window.location.origin || '';
    }
    return { siteBase };
  }

  const { siteBase } = resolveBases();

  window.PLAY_UNO_CONFIG = Object.freeze({
    SITE_BASE: siteBase,
    API_BASE: siteBase + '/api/rooms',
    // Place your installer as "TunoTogether_Setup.exe" directly in the project root folder,
    // or paste a direct download link (Dropbox, GitHub Releases, R2, etc.) below:
    DOWNLOAD_URL: 'https://www.dropbox.com/scl/fi/go4mpcc704mkr5yut5dhg/TunoTogether_Setup.exe?rlkey=rjxr3s0k8j312yfwi9kgrpcg7&st=d7optd0c&dl=1',
    MAX_PLAYERS: 10,
    ROOM_PREFIX: 'UNO-'
  });
})();
