chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchContent") {
    const firstDiv = document.querySelector("div");
    const content = firstDiv ? firstDiv.textContent.trim() : "No div found";
    sendResponse({ text: content });
  }
  return true;
});
