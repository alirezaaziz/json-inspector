// Runs before first paint to avoid a flash of the wrong theme.
try {
  var t = JSON.parse(localStorage.getItem('jip:theme'));
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable */ }
