/* global document, chrome, window */
document.getElementById("open-search").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "openSearchFromPopup" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Open search failed:", chrome.runtime.lastError);
    }
    window.close();
  });
});

document.getElementById("open-sidebar").addEventListener("click", () => {
  // Must open in this click handler (user gesture); background cannot open after async message.
  try {
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  } catch (e) {
    console.error("Open sidebar failed:", e);
  }
  chrome.runtime.sendMessage({ action: "openSidebarFromPopup" }, () => {
    if (chrome.runtime.lastError) {
      console.error("Set sidebar context:", chrome.runtime.lastError);
    }
    window.close();
  });
});
