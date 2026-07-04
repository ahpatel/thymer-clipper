// popup/popup.js - Popup operations (Accounts & Workspaces)

// Bind all event listeners safely inside DOMContentLoaded to avoid
// crashes if elements don't exist (e.g., after HTML restructuring)
document.addEventListener("DOMContentLoaded", () => {
  initPopup();

  const bind = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  };

  bind("settings-btn",  "click", openSettings);
  bind("setup-btn",     "click", openSettings);
  bind("save-btn",      "click", saveCurrentPage);
  bind("highlight-btn", "click", triggerHighlightSelection);
  bind("diag-btn",      "click", runDiagnostics);
});

let currentTab = null;
let configuredAccounts = [];
let openWorkspaces = {};
let selectedTags = new Set();
let existingTags = [];

// Send a message to a tab's content script.
// If the content script is dead (SPA navigation / context invalidated), re-inject it and retry once.
async function safeTabMessage(tabId, message) {
  const tryOnce = () => chrome.tabs.sendMessage(tabId, message);
  try {
    return await tryOnce();
  } catch (err) {
    const dead = err.message &&
      (err.message.includes("Receiving end does not exist") ||
       err.message.includes("Could not establish connection"));
    if (!dead) throw err;

    // Content script gone — re-inject and wait briefly for it to init
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/clipper.js"]
      });
      await new Promise(r => setTimeout(r, 600));
      return await tryOnce();
    } catch (injectErr) {
      throw new Error(`Content script unavailable: ${injectErr.message}`);
    }
  }
}

// Initialize popup details
async function initPopup() {
  // Get active tab details first
  try {
    const tabInfo = await chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB_INFO" });
    if (tabInfo && tabInfo.url) {
      currentTab = tabInfo;
      const titleInput = document.getElementById("page-title-input");
      if (titleInput) {
        titleInput.value = tabInfo.title || "Untitled Page";
      }
      
      const hostname = new URL(tabInfo.url).hostname;
      document.getElementById("page-url").textContent = hostname;

      // Detect if user is viewing a Thymer app tab
      if (hostname.endsWith("thymer.com") || hostname === "localhost" || hostname === "127.0.0.1") {
        document.getElementById("save-btn").disabled = true;
        document.getElementById("highlight-btn").disabled = true;
        document.getElementById("save-btn").style.opacity = "0.5";
        document.getElementById("highlight-btn").style.opacity = "0.5";
        showStatus("Active page is Thymer. Switch to another tab to clip content.", false, false);
        const statusText = document.getElementById("status-text");
        if (statusText) statusText.style.color = "#A78BFA"; // Helpful violet notice
      }
    }
  } catch (err) {
    console.error("Failed to query active tab details:", err);
  }

  // Load sync config and active session workspaces
  const storedSync = await chrome.storage.sync.get(["accounts", "workspaces", "securityToken"]);
  const storedSession = await chrome.storage.session.get("openWorkspaces");

  // Migrate backward compatibility workspaces -> accounts
  configuredAccounts = storedSync.accounts || storedSync.workspaces || [];
  const token = storedSync.securityToken || "";
  openWorkspaces = storedSession.openWorkspaces || {};

  // Update connection status dot indicator
  const connDot = document.getElementById("connection-indicator");
  const isConnected = Object.keys(openWorkspaces).length > 0;
  if (connDot) {
    if (isConnected) {
      connDot.classList.add("connected");
      connDot.title = "Connected to Thymer";
    } else {
      connDot.classList.remove("connected");
      connDot.title = "Disconnected (Open a Thymer tab)";
    }
  }

  // Show run diagnostics button only if not connected
  const diagBtn = document.getElementById("diag-btn");
  if (diagBtn) {
    if (isConnected) {
      diagBtn.classList.add("hidden");
    } else {
      diagBtn.classList.remove("hidden");
    }
  }

  if (configuredAccounts.length === 0 || !token) {
    // Show unconfigured UI state
    document.getElementById("unconfigured-state").classList.remove("hidden");
    document.getElementById("ready-state").classList.add("hidden");
    return;
  }

  // Show ready UI state
  document.getElementById("unconfigured-state").classList.add("hidden");
  document.getElementById("ready-state").classList.remove("hidden");

  // Fetch existing tags for autocomplete (and pre-fill for current page if already saved)
  if (isConnected) {
    try {
      const workspaceGuid = getTargetWorkspaceGuid();
      const pageUrl = currentTab ? currentTab.url : null;
      const res = await chrome.runtime.sendMessage({
        type: "GET_EXISTING_TAGS",
        url: pageUrl,
        workspaceGuid: workspaceGuid || null
      });
      if (res && res.payload) {
        const data = res.payload;
        if (data && typeof data === "object" && Array.isArray(data.tags)) {
          // New format: { tags: [...], pageTags: [...] }
          existingTags = data.tags;
          if (data.pageTags && data.pageTags.length > 0) {
            data.pageTags.forEach(t => selectedTags.add(t));
          }
        } else if (Array.isArray(data)) {
          // Legacy format: plain array
          existingTags = data;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch existing tags:", e);
    }
  }
  setupTagsInput();
}

// Helper to resolve active target workspace GUID dynamically
function getTargetWorkspaceGuid() {
  const activeAccount = configuredAccounts.find(a => a.isActive) || configuredAccounts[0];
  if (!activeAccount) return null;
  const workspacesForAccount = Object.entries(openWorkspaces)
    .filter(([_, info]) => info.accountSlug === activeAccount.slug)
    .map(([guid, _]) => guid);
  return workspacesForAccount[0] || null;
}

// Open settings page in new tab
function openSettings() {
  chrome.runtime.openOptionsPage();
}

// Show/hide status bar inside popup
function showStatus(text, showSpinner = false, isError = false) {
  const footer = document.getElementById("status-footer");
  const spinner = document.getElementById("spinner");
  const statusText = document.getElementById("status-text");

  footer.classList.remove("hidden");
  statusText.textContent = text;
  
  if (showSpinner) {
    spinner.classList.remove("hidden");
    statusText.className = "status-text";
  } else {
    spinner.classList.add("hidden");
    statusText.className = `status-text ${isError ? 'error' : 'success'}`;
  }
}

// Save active tab page to Thymer
async function saveCurrentPage() {
  if (!currentTab || !currentTab.id) {
    showStatus("Failed to resolve current active tab.", false, true);
    return;
  }

  const workspaceGuid = getTargetWorkspaceGuid();

  showStatus("Extracting content...", true);
  
  try {
    const pageData = await safeTabMessage(currentTab.id, { type: "CLIPPER_EXTRACT_CONTENT" });
    
    const titleInput = document.getElementById("page-title-input");
    if (titleInput && pageData) {
      pageData.title = titleInput.value.trim() || pageData.title;
    }
    if (pageData) {
      pageData.tags = Array.from(selectedTags);
    }
    
    showStatus("Saving to Thymer...", true);

    const result = await chrome.runtime.sendMessage({
      type: "SAVE_ARTICLE",
      payload: pageData,
      workspaceGuid: workspaceGuid || null
    });

    if (result && !result.error) {
      showStatus("Saved to Thymer ✓");
      
      try {
        await safeTabMessage(currentTab.id, {
          type: "CLIPPER_SHOW_TOAST",
          message: "Saved to Thymer ✓"
        });
      } catch (_) { /* toast is non-critical */ }

      setTimeout(() => window.close(), 1500);
    } else {
      throw new Error(result?.error || "Save operation failed.");
    }
  } catch (err) {
    console.error("Save click failed:", err);
    showStatus(`Failed: ${err.message}`, false, true);
  }
}

// Trigger selection highlight on current page
async function triggerHighlightSelection() {
  if (!currentTab || !currentTab.id) return;

  const workspaceGuid = getTargetWorkspaceGuid();

  try {
    await safeTabMessage(currentTab.id, { 
      type: "CLIPPER_TRIGGER_HIGHLIGHT",
      workspaceGuid: workspaceGuid || null
    });
    window.close();
  } catch (err) {
    console.error("Failed to trigger highlight from popup:", err);
    showStatus("Error triggering highlight.", false, true);
  }
}

// Run connection diagnostics and display result
async function runDiagnostics() {
  showStatus("Running diagnostics...", true);
  try {
    const result = await chrome.runtime.sendMessage({ type: "DIAGNOSE" });
    
    if (result && result.error) {
      showStatus(`Diag failed: ${result.error}`, false, true);
      return;
    }
    
    const lines = [
      `Token: ${result.hasToken ? '✓ ' + result.tokenPrefix : '✗ MISSING'}`,
      `Active account slug: ${result.activeAccountSlug || '✗ NONE'}`,
      `Thymer tabs found by URL query: ${result.thymerTabsFound.length}`,
      `Registered workspaces in session: ${Object.keys(result.openWorkspaces).length}`,
    ];

    if (result.thymerTabsFound.length > 0) {
      result.thymerTabsFound.forEach(t => lines.push(`  Tab: ${t.url}`));
    }
    if (Object.keys(result.openWorkspaces).length > 0) {
      Object.entries(result.openWorkspaces).forEach(([g, info]) => {
        lines.push(`  WS: ${info.name} (tab ${info.tabId})`);
      });
    }

    // Log to console for full detail
    console.log("[Thymer Diag]", JSON.stringify(result, null, 2));

    // Show summary in status — extend popup temporarily
    const footer = document.getElementById("status-footer");
    const spinner = document.getElementById("spinner");
    const statusText = document.getElementById("status-text");
    footer.classList.remove("hidden");
    spinner.classList.add("hidden");
    statusText.style.whiteSpace = "pre-wrap";
    statusText.style.fontSize = "10px";
    statusText.textContent = lines.join("\n");
  } catch (err) {
    showStatus(`Diag failed: ${err.message}`, false, true);
  }
}

// Setup autocomplete, tag chip rendering, and text entry listeners
function setupTagsInput() {
  const container = document.getElementById("tag-container");
  const input = document.getElementById("tag-input");
  const autocomplete = document.getElementById("tag-autocomplete");
  if (!container || !input || !autocomplete) return;

  function renderTags() {
    // Remove existing chips
    container.querySelectorAll(".tag-chip").forEach(chip => chip.remove());
    
    // Insert new chips before the input
    Array.from(selectedTags).forEach(tag => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      
      const removeBtn = document.createElement("span");
      removeBtn.className = "tag-remove";
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedTags.delete(tag);
        renderTags();
      });
      
      chip.appendChild(removeBtn);
      container.insertBefore(chip, input);
    });
  }

  function addTag(tagText) {
    const trimmed = tagText.trim();
    if (trimmed && !selectedTags.has(trimmed)) {
      selectedTags.add(trimmed);
      renderTags();
    }
    input.value = "";
    hideAutocomplete();
  }

  function showAutocomplete(query) {
    const cleanQuery = query.toLowerCase().trim();
    if (!cleanQuery) {
      hideAutocomplete();
      return;
    }

    const matches = existingTags.filter(tag => 
      tag.toLowerCase().includes(cleanQuery) && !selectedTags.has(tag)
    );

    if (matches.length === 0) {
      hideAutocomplete();
      return;
    }

    autocomplete.innerHTML = "";
    matches.forEach(match => {
      const item = document.createElement("div");
      item.className = "tag-autocomplete-item";
      item.textContent = match;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent blur before click
        addTag(match);
      });
      autocomplete.appendChild(item);
    });
    autocomplete.classList.remove("hidden");
  }

  function hideAutocomplete() {
    autocomplete.classList.add("hidden");
    autocomplete.innerHTML = "";
  }

  // Add tag on Enter or comma
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input.value);
    } else if (e.key === "Backspace" && !input.value && selectedTags.size > 0) {
      // Remove last tag if backspace is pressed on empty input
      const tagsArr = Array.from(selectedTags);
      const lastTag = tagsArr[tagsArr.length - 1];
      selectedTags.delete(lastTag);
      renderTags();
    }
  });

  input.addEventListener("input", (e) => {
    showAutocomplete(input.value);
  });

  input.addEventListener("blur", () => {
    // Delay slightly to allow click event on autocomplete item to fire
    setTimeout(hideAutocomplete, 200);
  });

  container.addEventListener("click", () => {
    input.focus();
  });
}
