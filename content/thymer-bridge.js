// content/thymer-bridge.js - Injected specifically on *.thymer.com tabs

console.log("Thymer Clipper Bridge content script injected.");

// Keep track of pending response callbacks by requestId
const pendingRequests = new Map();

// Check if this content script's extension context is still valid.
// Returns false after the extension is reloaded/updated while the page is open.
function isContextValid() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

// Safe wrapper around chrome.runtime.sendMessage — silently drops if context is gone
function safeSend(message) {
  if (!isContextValid()) return;
  try {
    chrome.runtime.sendMessage(message)
      .catch(err => {
        if (!err.message?.includes("context invalidated") &&
            !err.message?.includes("Extension context")) {
          console.warn("Bridge send failed:", err.message);
        }
      });
  } catch (e) {
    // context invalidated — ignore
  }
}

// Announce ready status to background script
safeSend({ type: "THYMER_BRIDGE_READY" });

// Safe UUID generator supporting non-secure contexts (HTTP)
function generateUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Trigger ping to plugin to request workspace details
function pingPlugin() {
  window.dispatchEvent(new CustomEvent("thymer-clipper-ping"));
}

// Listen for messages from background script — only register if context is valid
try {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isContextValid()) return;
    if (message.type === "BRIDGE_FORWARD") {
      const { action, payload, token } = message;
      const requestId = generateUUID();

      pendingRequests.set(requestId, sendResponse);

      window.dispatchEvent(new CustomEvent("thymer-clipper-request", {
        detail: { action, payload, token, requestId }
      }));

      return true; // keep channel open for async sendResponse
    }
  });
} catch (e) {
  console.warn("Could not register bridge message listener:", e.message);
}

// Listen for responses dispatched by the Thymer App Plugin in page context
window.addEventListener("thymer-clipper-response", (event) => {
  const { requestId, payload, error } = event.detail || {};
  if (!requestId) return;

  const sendResponse = pendingRequests.get(requestId);
  if (sendResponse) {
    sendResponse({ payload, error });
    pendingRequests.delete(requestId);
  }
});

// Listen for workspace announcements from the plugin
window.addEventListener("thymer-clipper-announce", (event) => {
  const { workspaceGuid, workspaceName, accountSlug } = event.detail || {};
  if (!workspaceGuid) return;

  safeSend({
    type: "THYMER_TAB_ANNOUNCE",
    payload: { workspaceGuid, workspaceName, accountSlug }
  });
});

// Listen for ping requests from the page (in case plugin reloads/starts late)
window.addEventListener("thymer-clipper-ping-request", () => {
  pingPlugin();
});

// Initial ping — triggers the plugin to announce its workspace
setTimeout(pingPlugin, 500);

