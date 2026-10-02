/* Sets the saved (or system) theme before the page paints, so there is no flash. Served as a file so the strict CSP allows it. */
(function () {
  try {
    var t = localStorage.getItem('s2s_theme');
    var m = localStorage.getItem('s2s_mode');
    if (t !== 'graphite' && t !== 'burst' && t !== 'meadow') t = 'graphite';
    if (m !== 'light' && m !== 'dark') m = 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.setAttribute('data-mode', m);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'graphite');
    document.documentElement.setAttribute('data-mode', 'light');
  }
})();
