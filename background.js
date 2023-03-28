// Keep the service worker awake by responding to messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  sendResponse({});
});
