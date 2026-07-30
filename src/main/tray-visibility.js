function reconcileTrayVisibility({ shouldShow, tray, createTray }) {
  if (shouldShow) return tray || createTray();
  if (tray) tray.destroy();
  return null;
}

module.exports = { reconcileTrayVisibility };
