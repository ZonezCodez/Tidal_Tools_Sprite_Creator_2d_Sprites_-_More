/* Apply the saved workspace and artboard theme before first paint. */
(() => {
  const themes = {
    onyx: ['dark', 'dark'],
    prism: ['light', 'light'],
    'onyx-prism': ['dark', 'light'],
    'prism-onyx': ['light', 'dark'],
    dark: ['dark', 'dark'],
    light: ['light', 'light']
  };
  try {
    const key = localStorage.getItem('spritecreator-theme') || 'onyx';
    const [ui, canvas] = themes[key] || themes.onyx;
    document.documentElement.dataset.theme = ui;
    document.documentElement.dataset.canvasTheme = canvas;
  } catch {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.dataset.canvasTheme = 'dark';
  }
})();
