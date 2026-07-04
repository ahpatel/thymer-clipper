// background.js - Thymer Web Clipper Service Worker (Accounts & Workspaces)

// Keep track of pending tab initialization resolvers by tabId
const pendingTabs = new Map();

// Send a message to a content script, re-injecting clipper.js once if the channel is dead.
async function safeTabMessage(tabId, message) {
  const tryOnce = () => chrome.tabs.sendMessage(tabId, message);
  try {
    return await tryOnce();
  } catch (err) {
    const dead = err.message &&
      (err.message.includes("Receiving end does not exist") ||
       err.message.includes("Could not establish connection"));
    if (!dead) throw err;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content/clipper.js"] });
      await new Promise(r => setTimeout(r, 600));
      return await tryOnce();
    } catch (injectErr) {
      throw new Error(`Content script unavailable: ${injectErr.message}`);
    }
  }
}

// Top-level event listener registrations (synchronous)
chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
chrome.commands.onCommand.addListener(handleCommand);
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

// Handle cleanups on tab closing
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { openWorkspaces = {} } = await chrome.storage.session.get("openWorkspaces");
  let updated = false;

  for (const [guid, info] of Object.entries(openWorkspaces)) {
    if (info.tabId === tabId) {
      delete openWorkspaces[guid];
      updated = true;
    }
  }

  if (updated) {
    await chrome.storage.session.set({ openWorkspaces });
    console.log(`Cleaned up workspaces for closed tab ${tabId}`);
  }
});

// 1. Initialization
async function initializeExtension() {
  chrome.contextMenus.create({
    id: "save-page",
    title: "Save page to Thymer",
    contexts: ["page", "link"]
  });

  chrome.contextMenus.create({
    id: "save-selection",
    title: "Save selection as highlight",
    contexts: ["selection"]
  });

  // Clear ephemeral session registry on start
  await chrome.storage.session.remove("openWorkspaces");
  console.log("Thymer Web Clipper background worker initialized.");
}

// 2. Context Menu Handler
async function handleContextMenuClick(info, tab) {
  if (!tab) return;
  
  if (info.menuItemId === "save-page") {
    await saveArticleFromTab(tab.id, info.linkUrl || tab.url);
  } else if (info.menuItemId === "save-selection") {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "CLIPPER_TRIGGER_HIGHLIGHT",
        selectionText: info.selectionText
      });
    } catch (err) {
      console.error("Failed to trigger highlight from context menu:", err);
      showNotification("Error", "Please refresh the page to use Thymer Clipper.");
    }
  }
}

// 3. Keyboard Commands Handler
async function handleCommand(command, tab) {
  if (!tab) return;

  if (command === "save-article") {
    await saveArticleFromTab(tab.id, tab.url);
  } else if (command === "add-highlight") {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "CLIPPER_TRIGGER_HIGHLIGHT" });
    } catch (err) {
      console.error("Failed to trigger highlight command:", err);
    }
  }
}

// 4. Runtime Messaging Handler
function handleRuntimeMessage(message, sender, sendResponse) {
  const isAsync = true;

  (async () => {
    try {
      switch (message.type) {
        case "THYMER_BRIDGE_READY":
          // Bridge is ready, resolve any pending tab creation wait
          if (sender.tab) {
            console.log(`Bridge content script ready in tab ${sender.tab.id}`);
            const resolver = pendingTabs.get(sender.tab.id);
            if (resolver) {
              resolver(sender.tab.id);
              pendingTabs.delete(sender.tab.id);
            }
          }
          sendResponse({ status: "acknowledged" });
          break;

        case "THYMER_TAB_ANNOUNCE":
          // Plugin has announced workspace GUID and name
          if (sender.tab) {
            const { workspaceGuid, workspaceName, accountSlug } = message.payload;
            const { openWorkspaces = {} } = await chrome.storage.session.get("openWorkspaces");
            
            openWorkspaces[workspaceGuid] = {
              tabId: sender.tab.id,
              accountSlug,
              name: workspaceName,
              lastSeen: Date.now()
            };
            
            await chrome.storage.session.set({ openWorkspaces });
            console.log(`Registered active workspace: ${workspaceName} (${workspaceGuid}) on tab ${sender.tab.id}`);
          }
          sendResponse({ success: true });
          break;

        case "SAVE_ARTICLE":
          const saveResult = await sendToThymerBridge("SAVE_ARTICLE", message.payload, message.workspaceGuid);
          sendResponse(saveResult);
          break;

        case "ADD_HIGHLIGHT":
          const hlResult = await sendToThymerBridge("ADD_HIGHLIGHT", message.payload, message.workspaceGuid);
          sendResponse(hlResult);
          break;

        case "DELETE_HIGHLIGHT":
          const deleteResult = await sendToThymerBridge("DELETE_HIGHLIGHT", message.payload, message.workspaceGuid);
          sendResponse(deleteResult);
          break;

        case "UPDATE_HIGHLIGHT_NOTE":
          const updateResult = await sendToThymerBridge("UPDATE_HIGHLIGHT_NOTE", message.payload, message.workspaceGuid);
          sendResponse(updateResult);
          break;

        case "GET_PAGE_HIGHLIGHTS":
          const highlightsResult = await sendToThymerBridge("GET_PAGE_HIGHLIGHTS", { url: message.url }, message.workspaceGuid);
          sendResponse(highlightsResult);
          break;

        case "GET_EXISTING_TAGS":
          const tagsResult = await sendToThymerBridge("GET_EXISTING_TAGS", { url: message.url || null }, message.workspaceGuid);
          sendResponse(tagsResult);
          break;

        case "DIAGNOSE": {
          const diagSync = await chrome.storage.sync.get(["accounts", "securityToken"]);
          const diagSession = await chrome.storage.session.get("openWorkspaces");
          const diagAccounts = diagSync.accounts || [];
          const diagActiveAcc = diagAccounts.find(a => a.isActive);
          const diagSlug = diagActiveAcc ? diagActiveAcc.slug : null;
          const diagToken = diagSync.securityToken || null;
          const diagWorkspaces = diagSession.openWorkspaces || {};

          // Try tab query
          let diagTabsFound = [];
          if (diagSlug) {
            const accountUrl = diagSlug.includes(".") || diagSlug.includes(":") || diagSlug.startsWith("localhost")
              ? (diagSlug.startsWith("http") ? diagSlug : `http://${diagSlug}`)
              : `https://${diagSlug}.thymer.com`;
            const searchUrl = accountUrl.endsWith("/") ? `${accountUrl}*` : `${accountUrl}/*`;
            const tabs = await chrome.tabs.query({ url: searchUrl });
            diagTabsFound = tabs.map(t => ({ id: t.id, url: t.url, title: t.title }));
          }

          sendResponse({
            hasToken: !!diagToken,
            tokenPrefix: diagToken ? diagToken.substring(0, 8) + "..." : null,
            activeAccountSlug: diagSlug,
            configuredAccounts: diagAccounts.map(a => ({ slug: a.slug, isActive: a.isActive })),
            openWorkspaces: diagWorkspaces,
            thymerTabsFound: diagTabsFound
          });
          break;
        }

        case "GET_ACTIVE_TAB_INFO":
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sendResponse({ 
            url: activeTab?.url || "", 
            title: activeTab?.title || "",
            id: activeTab?.id || null
          });
          break;

        default:
          sendResponse({ error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      console.error(`Error handling message ${message.type}:`, err);
      sendResponse({ error: err.message });
    }
  })();

  return isAsync;
}

// 5. Find or Create Thymer Tab for a target Workspace GUID
async function getThymerTab(targetWorkspaceGuid) {
  const { openWorkspaces = {} } = await chrome.storage.session.get("openWorkspaces");
  
  // 1. If a specific workspace guid is requested and open, use its tab
  if (targetWorkspaceGuid && openWorkspaces[targetWorkspaceGuid]) {
    const info = openWorkspaces[targetWorkspaceGuid];
    // Double check that the tab still exists
    try {
      const tab = await chrome.tabs.get(info.tabId);
      return tab.id;
    } catch (e) {
      // Tab was closed but not caught yet, remove it from registry
      delete openWorkspaces[targetWorkspaceGuid];
      await chrome.storage.session.set({ openWorkspaces });
    }
  }

  // 2. If no target workspace, look for any open Thymer tab matching active account slug
  const { accounts = [] } = await chrome.storage.sync.get("accounts");
  const activeAccount = accounts.find(a => a.isActive);
  const slug = activeAccount ? activeAccount.slug : "";
  
  if (!slug) {
    throw new Error("No active account configured. Please open extension settings.");
  }

  // Resolve account URL dynamically (supports custom domains, ports, localhost)
  const accountUrl = slug.includes(".") || slug.includes(":") || slug.startsWith("localhost")
    ? (slug.startsWith("http") ? slug : `http://${slug}`)
    : `https://${slug}.thymer.com`;

  // Search tabs
  const searchUrl = accountUrl.endsWith("/") ? `${accountUrl}*` : `${accountUrl}/*`;
  const tabs = await chrome.tabs.query({ url: searchUrl });
  if (tabs.length > 0) {
    return tabs[0].id;
  }

  // 3. None open, create background tab
  console.log(`Opening Thymer account in background: ${accountUrl}`);
  const newTab = await chrome.tabs.create({
    url: accountUrl,
    active: false
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingTabs.delete(newTab.id);
      reject(new Error(`Timed out waiting for Thymer tab at ${accountUrl} to load.`));
    }, 15000);

    pendingTabs.set(newTab.id, (tabId) => {
      clearTimeout(timeout);
      resolve(tabId);
    });
  });
}

// 6. Send payload to the Thymer tab
async function sendToThymerBridge(action, payload, targetWorkspaceGuid) {
  const { securityToken } = await chrome.storage.sync.get("securityToken");
  if (!securityToken) {
    throw new Error("Security token not configured. Please open settings.");
  }

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 700;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const tabId = await getThymerTab(targetWorkspaceGuid);

      const response = await chrome.tabs.sendMessage(tabId, {
        type: "BRIDGE_FORWARD",
        action,
        payload,
        token: securityToken
      });

      if (response && response.error) {
        throw new Error(response.error);
      }
      return response;
    } catch (err) {
      const isNotReady = err.message &&
        (err.message.includes("Receiving end does not exist") ||
         err.message.includes("Could not establish connection"));

      if (isNotReady && attempt < MAX_RETRIES) {
        console.warn(`Bridge not ready yet, retrying (${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }

      console.error("Bridge communication failed:", err);
      return { error: err.message };
    }
  }
}

// 7. Extract page content and save to default workspace
async function saveArticleFromTab(tabId, url) {
  try {
    const pageData = await safeTabMessage(tabId, { type: "CLIPPER_EXTRACT_CONTENT" });
    
    await chrome.action.setBadgeText({ tabId, text: "..." });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#7C3AED" });

    // Save using the default/last active workspace (or let sendToThymerBridge auto-resolve)
    const result = await sendToThymerBridge("SAVE_ARTICLE", pageData, null);
    
    if (result && !result.error) {
      await chrome.action.setBadgeText({ tabId, text: "✓" });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#10B981" });
      setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }), 3000);

      try {
        await safeTabMessage(tabId, {
          type: "CLIPPER_SHOW_TOAST",
          message: "Saved to Thymer ✓"
        });
      } catch (_) { /* toast is non-critical */ }
    } else {
      throw new Error(result?.error || "Unknown bridge save error");
    }
  } catch (err) {
    console.error("Save article failed:", err);
    await chrome.action.setBadgeText({ tabId, text: "err" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#EF4444" });
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }), 3000);

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "CLIPPER_SHOW_TOAST",
        message: `Save failed: ${err.message}`,
        isError: true
      });
    } catch (_) {
      showNotification("Thymer Clipper Error", err.message);
    }
  }
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: title,
    message: message
  });
}
