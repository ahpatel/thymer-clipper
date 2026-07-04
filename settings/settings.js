// settings/settings.js - Configuration management (Accounts)

document.addEventListener("DOMContentLoaded", loadSettings);
document.getElementById("add-account-btn").addEventListener("click", addAccountRow);
document.getElementById("generate-token-btn").addEventListener("click", generateSecurityToken);
document.getElementById("toggle-token-btn").addEventListener("click", toggleTokenVisibility);
document.getElementById("save-settings-btn").addEventListener("click", saveSettings);

let accountsList = [];

let openWorkspaces = {};

// Load settings from sync storage
async function loadSettings() {
  const defaults = {
    accounts: [{ slug: "app", displayName: "Default Account", isActive: true }],
    securityToken: "",
    defaultCollection: "Bookmarks"
  };

  const stored = await chrome.storage.sync.get(["accounts", "workspaces", "securityToken", "defaultCollection"]);
  const storedSession = await chrome.storage.session.get("openWorkspaces");
  
  // Migration fallback: if workspaces exists but accounts doesn't, migrate it
  const initialAccounts = stored.accounts || stored.workspaces || defaults.accounts;
  const settings = {
    accounts: initialAccounts,
    securityToken: stored.securityToken || defaults.securityToken,
    defaultCollection: stored.defaultCollection || defaults.defaultCollection
  };

  document.getElementById("security-token").value = settings.securityToken;
  document.getElementById("default-collection").value = settings.defaultCollection;
  
  accountsList = settings.accounts;
  openWorkspaces = storedSession.openWorkspaces || {};

  renderAccounts();
  populatePreferenceSelectors();
}

function populatePreferenceSelectors() {
  const accountSelect = document.getElementById("settings-account-select");
  if (!accountSelect) return;

  // Populate Accounts
  accountSelect.innerHTML = "";
  accountsList.forEach(acc => {
    const opt = document.createElement("option");
    opt.value = acc.slug;
    opt.textContent = acc.displayName || acc.slug;
    opt.selected = acc.isActive;
    accountSelect.appendChild(opt);
  });

  // Handle Account switch
  accountSelect.onchange = (e) => {
    const selectedSlug = e.target.value;
    accountsList.forEach(acc => {
      acc.isActive = acc.slug === selectedSlug;
    });
    renderAccounts(); // update visual checkmarks
    updateWorkspaceSelect(selectedSlug);
  };

  // Populate Workspaces for active account
  const activeAccount = accountsList.find(a => a.isActive) || accountsList[0];
  updateWorkspaceSelect(activeAccount ? activeAccount.slug : "");
}

function updateWorkspaceSelect(accountSlug) {
  const workspaceSelect = document.getElementById("settings-workspace-select");
  if (!workspaceSelect) return;
  workspaceSelect.innerHTML = "";

  const workspacesForAccount = Object.entries(openWorkspaces)
    .filter(([_, info]) => info.accountSlug === accountSlug)
    .map(([guid, info]) => ({ guid, name: info.name }));

  if (workspacesForAccount.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No open workspaces (Default)";
    workspaceSelect.appendChild(opt);
  } else {
    workspacesForAccount.forEach(ws => {
      const opt = document.createElement("option");
      opt.value = ws.guid;
      opt.textContent = ws.name;
      workspaceSelect.appendChild(opt);
    });
  }
}

// Render the list of accounts
function renderAccounts() {
  const container = document.getElementById("accounts-list");
  container.innerHTML = "";

  accountsList.forEach((acc, index) => {
    const row = document.createElement("div");
    row.className = `workspace-row ${acc.isActive ? 'active' : ''}`;
    
    row.innerHTML = `
      <div class="radio-check ${acc.isActive ? 'active' : ''}" title="Set as active account"></div>
      <div class="row-inputs">
        <div class="row-input-slug">
          <input type="text" class="input acc-slug" placeholder="account-slug" value="${acc.slug}">
        </div>
        <div class="row-input-name">
          <input type="text" class="input acc-name" placeholder="Display Name" value="${acc.displayName}">
        </div>
      </div>
      <button class="btn btn-danger btn-remove-acc" title="Remove account">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
      </button>
    `;

    // Click handler for making active
    row.querySelector(".radio-check").addEventListener("click", () => {
      setActiveAccount(index);
    });

    // Inputs value sync
    row.querySelector(".acc-slug").addEventListener("input", (e) => {
      accountsList[index].slug = e.target.value.trim().toLowerCase();
    });

    row.querySelector(".acc-name").addEventListener("input", (e) => {
      accountsList[index].displayName = e.target.value.trim();
    });

    // Remove button
    row.querySelector(".btn-remove-acc").addEventListener("click", () => {
      removeAccount(index);
    });

    container.appendChild(row);
  });
}

// Add a new blank account row
function addAccountRow() {
  accountsList.push({
    slug: "",
    displayName: "",
    isActive: accountsList.length === 0
  });
  renderAccounts();
}

// Remove an account row
function removeAccount(index) {
  const wasActive = accountsList[index].isActive;
  accountsList.splice(index, 1);
  if (wasActive && accountsList.length > 0) {
    accountsList[0].isActive = true;
  }
  renderAccounts();
}

// Set active account
function setActiveAccount(activeIndex) {
  accountsList.forEach((acc, idx) => {
    acc.isActive = idx === activeIndex;
  });
  renderAccounts();
}

// Generate random secure security token UUID
function generateSecurityToken() {
  const tokenInput = document.getElementById("security-token");
  tokenInput.value = crypto.randomUUID();
  tokenInput.type = "text"; // show it so user can copy it
}

// Toggle password visibility of security token
function toggleTokenVisibility() {
  const tokenInput = document.getElementById("security-token");
  if (tokenInput.type === "password") {
    tokenInput.type = "text";
  } else {
    tokenInput.type = "password";
  }
}

// Show status message with animations
function showStatus(text, isError = false) {
  const statusDiv = document.getElementById("status-message");
  statusDiv.textContent = text;
  statusDiv.className = `status-msg ${isError ? 'error' : 'success'}`;
  
  setTimeout(() => {
    statusDiv.style.opacity = "0";
    setTimeout(() => {
      statusDiv.textContent = "";
      statusDiv.style.opacity = "1";
    }, 200);
  }, 3000);
}

// Save settings to sync storage
async function saveSettings() {
  const accountSelect = document.getElementById("settings-account-select");
  if (accountSelect) {
    const selectedSlug = accountSelect.value;
    accountsList.forEach(acc => {
      acc.isActive = acc.slug === selectedSlug;
    });
  }

  // Validate accounts
  const validAccounts = accountsList.filter(acc => acc.slug && acc.displayName);
  if (validAccounts.length === 0) {
    showStatus("Please configure at least one account with a slug and name.", true);
    return;
  }

  // Ensure one is active
  if (!validAccounts.some(acc => acc.isActive)) {
    validAccounts[0].isActive = true;
  }

  const securityToken = document.getElementById("security-token").value.trim();
  if (!securityToken) {
    showStatus("Please enter or generate a security token.", true);
    return;
  }

  const defaultCollection = document.getElementById("default-collection").value.trim() || "Bookmarks";

  try {
    // Clear legacy workspaces key to stay clean, and set accounts key
    await chrome.storage.sync.remove("workspaces");
    await chrome.storage.sync.set({
      accounts: validAccounts,
      securityToken,
      defaultCollection
    });
    
    accountsList = validAccounts;
    renderAccounts();
    showStatus("Configuration saved successfully!");
  } catch (err) {
    console.error("Save settings error:", err);
    showStatus("Failed to save settings: " + err.message, true);
  }
}
