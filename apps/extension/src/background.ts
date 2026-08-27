chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
  console.warn('[ZFS BOE Inspector] Side Panel 初始化失败', error);
});
