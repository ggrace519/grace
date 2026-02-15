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
  chrome.runtime.sendMessage({ action: "openSidebarFromPopup" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Open sidebar failed:", chrome.runtime.lastError);
    }
    window.close();
  });
});
