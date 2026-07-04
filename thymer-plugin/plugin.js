// thymer-plugin/plugin.js - Thymer App Plugin bridge receiver

class Plugin extends AppPlugin {
  onLoad() {
    console.log("Thymer Clipper App Plugin loaded.");
    
    // Register the bridge request event listener on window
    this._requestListener = (event) => this.handleClipperRequest(event);
    window.addEventListener("thymer-clipper-request", this._requestListener);

    // Register ping listener from content script bridge
    this._pingListener = () => this.announceWorkspace();
    window.addEventListener("thymer-clipper-ping", this._pingListener);

    // Register command palette command
    try {
      this._settingsCmd = this.ui.addCommandPaletteCommand({
        label: "Plugins: Clipper Settings",
        icon: "ti-link",
        onSelected: () => this.showSettingsModal()
      });
    } catch (e) {
      console.warn("Failed to register command palette command:", e);
    }

    // Announce immediately on load
    this.announceWorkspace();
  }

  onUnload() {
    if (this._requestListener) {
      window.removeEventListener("thymer-clipper-request", this._requestListener);
    }
    if (this._pingListener) {
      window.removeEventListener("thymer-clipper-ping", this._pingListener);
    }
    if (this._settingsCmd) {
      try {
        this._settingsCmd.remove();
      } catch (_) {}
    }
  }

  // Get human-readable workspace name from Thymer DOM context
  getWorkspaceName() {
    const el = document.querySelector(".workspace-name, .active-workspace-name, [data-testid='workspace-name'], .active-ws-title");
    if (el && el.textContent) {
      return el.textContent.trim();
    }
    
    try {
      const activeUser = this.data.getActiveUsers()[0];
      if (activeUser) {
        return `${activeUser.displayName || activeUser.email.split('@')[0]}'s Workspace`;
      }
    } catch (_) {}

    return "Default Workspace";
  }

  // Announce this plugin instance's workspace guidelines to the extension
  announceWorkspace() {
    try {
      const workspaceGuid = this.getWorkspaceGuid();
      const workspaceName = this.getWorkspaceName();
      const accountSlug = window.location.hostname.split(".")[0];

      const event = new CustomEvent("thymer-clipper-announce", {
        detail: {
          workspaceGuid,
          workspaceName,
          accountSlug
        }
      });
      window.dispatchEvent(event);
      console.log(`Announced workspace: ${workspaceName} (${workspaceGuid}) on account: ${accountSlug}`);
    } catch (err) {
      console.warn("Failed to announce workspace details:", err);
    }
  }

  // Display a premium custom modal dialog to configure clipper settings
  showSettingsModal() {
    // Prevent duplicate modals
    if (document.getElementById("thymer-clipper-modal-root")) return;

    const config = this.getConfiguration();
    const currentToken = config.custom && config.custom.security_token || "";

    // Create modal root container
    const modalRoot = document.createElement("div");
    modalRoot.id = "thymer-clipper-modal-root";
    
    // Inject modal styles directly
    const style = document.createElement("style");
    style.textContent = `
      #thymer-clipper-modal-root {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(11, 15, 25, 0.6);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .clipper-modal-card {
        background: #111827;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 32px;
        width: 100%;
        max-width: 440px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        color: #F9FAFB;
      }
      .clipper-modal-title {
        font-size: 20px;
        font-weight: 700;
        margin-bottom: 8px;
        background: linear-gradient(135deg, #FFFFFF 0%, #D1D5DB 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .clipper-modal-desc {
        font-size: 13px;
        color: #9CA3AF;
        line-height: 1.5;
        margin-bottom: 24px;
      }
      .clipper-form-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 24px;
      }
      .clipper-label {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #9CA3AF;
      }
      .clipper-input {
        width: 100%;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 10px 14px;
        color: #FFFFFF;
        font-size: 14px;
        outline: none;
        box-sizing: border-box;
      }
      .clipper-input:focus {
        border-color: #C084FC;
        box-shadow: 0 0 0 2px rgba(192, 132, 252, 0.2);
      }
      .clipper-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      .clipper-btn {
        font-size: 14px;
        font-weight: 500;
        border: none;
        border-radius: 10px;
        padding: 10px 20px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .clipper-btn-primary {
        background: linear-gradient(135deg, #7C3AED 0%, #C084FC 100%);
        color: #FFFFFF;
        font-weight: 600;
      }
      .clipper-btn-primary:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
      }
      .clipper-btn-secondary {
        background: rgba(255, 255, 255, 0.05);
        color: #F9FAFB;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .clipper-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.1);
      }
    `;
    modalRoot.appendChild(style);

    // Create modal DOM structure
    const card = document.createElement("div");
    card.className = "clipper-modal-card";
    card.innerHTML = `
      <div class="clipper-modal-title">Thymer Clipper Settings</div>
      <div class="clipper-modal-desc">Configure security credentials for browser extension saves to this workspace.</div>
      
      <div class="clipper-form-group">
        <label class="clipper-label" for="clipper-token-input">Security Token</label>
        <input type="password" id="clipper-token-input" class="clipper-input" placeholder="Paste generated token..." value="${currentToken}">
      </div>

      <div class="clipper-modal-actions">
        <button id="clipper-cancel-btn" class="clipper-btn clipper-btn-secondary">Cancel</button>
        <button id="clipper-save-btn" class="clipper-btn clipper-btn-primary">Save Token</button>
      </div>
    `;
    modalRoot.appendChild(card);
    document.body.appendChild(modalRoot);

    // Add modal click actions
    document.getElementById("clipper-cancel-btn").addEventListener("click", () => {
      modalRoot.remove();
    });

    document.getElementById("clipper-save-btn").addEventListener("click", async () => {
      const newToken = document.getElementById("clipper-token-input").value.trim();
      if (!newToken) {
        alert("Please enter a security token.");
        return;
      }

      modalRoot.remove();
      await this.saveSecurityToken(newToken);
    });
  }

  // Save security token in the plugin configuration
  async asyncSaveConfig(newToken) {
    try {
      const config = this.getConfiguration();
      const newConf = {
        ...config,
        custom: {
          ...config.custom,
          security_token: newToken
        }
      };

      // Retrieve database reference to the global plugin to persist settings
      const globalPlugins = await this.data.getAllGlobalPlugins();
      const myPlugin = globalPlugins.find(p => p.getGuid() === this.getGuid());
      
      if (myPlugin) {
        const success = await myPlugin.saveConfiguration(newConf);
        return success;
      }
      return false;
    } catch (err) {
      console.error("Failed to save settings configuration:", err);
      return false;
    }
  }

  async saveSecurityToken(newToken) {
    const success = await this.asyncSaveConfig(newToken);
    
    if (success) {
      this.ui.addToaster({
        title: "Clipper Setup",
        message: "Security token updated successfully!",
        dismissible: true,
        autoDestroyTime: 4000
      });
      // Trigger update announcement
      this.announceWorkspace();
    } else {
      this.ui.addToaster({
        title: "Clipper Setup",
        message: "Failed to persist token settings.",
        dismissible: true,
        autoDestroyTime: 4000
      });
    }
  }

  // Handle incoming clipper events from content script bridge
  async handleClipperRequest(event) {
    const { action, payload, token, requestId } = event.detail || {};
    if (!requestId) return;

    try {
      // 1. Validate security token
      const config = this.getConfiguration();
      const expectedToken = config.custom && config.custom.security_token;
      
      if (!expectedToken) {
        throw new Error("Clipper plugin security token is not configured in Thymer.");
      }
      if (token !== expectedToken) {
        throw new Error("Access denied: Invalid security token.");
      }

      // 2. Route the action
      let responsePayload = null;
      switch (action) {
        case "SAVE_ARTICLE":
          responsePayload = await this.saveArticle(payload);
          break;
        case "ADD_HIGHLIGHT":
          responsePayload = await this.addHighlight(payload);
          break;
        case "DELETE_HIGHLIGHT":
          responsePayload = await this.deleteHighlight(payload);
          break;
        case "UPDATE_HIGHLIGHT_NOTE":
          responsePayload = await this.updateHighlightNote(payload);
          break;
        case "GET_PAGE_HIGHLIGHTS":
          responsePayload = await this.getPageHighlights(payload);
          break;
        case "GET_EXISTING_TAGS":
          responsePayload = await this.getExistingTags();
          break;
        default:
          throw new Error(`Unsupported action: ${action}`);
      }

      // 3. Dispatch successful response
      this.reply(requestId, responsePayload, null);
    } catch (err) {
      console.error("Clipper request failed:", err);
      this.reply(requestId, null, err.message);
    }
  }

  // Dispatch response back to the content script bridge
  reply(requestId, payload, error) {
    const event = new CustomEvent("thymer-clipper-response", {
      detail: {
        requestId,
        payload,
        error
      }
    });
    window.dispatchEvent(event);
  }

  // Set up Bookmarks and Contacts collections dynamically with correct schema
  async ensureCollections() {
    // 1. Ensure Contacts collection exists (required for author relation)
    const contacts = await this.getOrCreateCollection("Contacts", (guid) => ({
      item_name: "Contact",
      icon: "user",
      fields: [
        { id: "platform", label: "Platform", type: "text", icon: "ti-world", active: true, read_only: false, many: false },
        { id: "profile_url", label: "Profile URL", type: "url", icon: "ti-link", active: true, read_only: false, many: false },
        { id: "handle", label: "Handle", type: "text", icon: "ti-at", active: true, read_only: false, many: false }
      ],
      views: [
        {
          id: "all",
          label: "All Contacts",
          description: "List of contacts and authors",
          icon: "ti-list",
          type: "overview",
          shown: true,
          read_only: false,
          field_ids: ["platform", "profile_url", "handle"],
          sort_field_id: "handle",
          sort_dir: "asc"
        }
      ],
      managed: { fields: true, views: true, sidebar: true },
      home: false
    }));

    // 2. Ensure Bookmarks collection exists
    const bookmarks = await this.getOrCreateCollection("Bookmarks", (guid) => ({
      item_name: "Bookmark",
      icon: "bookmark",
      fields: [
        { id: "status", label: "Status", type: "choice", icon: "ti-circle-check", active: true, read_only: false, many: false, choices: [
          { id: "unread", label: "Unread", color: "blue", active: true },
          { id: "reading", label: "Reading", color: "yellow", active: true },
          { id: "archived", label: "Archived", color: "gray", active: true }
        ]},
        { id: "site", label: "Site/Publisher", type: "text", icon: "ti-world", active: true, read_only: false, many: false },
        { id: "excerpt", label: "Excerpt", type: "text", icon: "ti-quote", active: true, read_only: false, many: false },
        { id: "word_count", label: "Word Count", type: "number", icon: "ti-file-text", active: true, read_only: false, many: false },
        { id: "url", label: "Source URL", type: "url", icon: "ti-link", active: true, read_only: false, many: false },
        { id: "saved_at", label: "Saved At", type: "datetime", icon: "ti-calendar", active: true, read_only: false, many: false },
        { id: "tags", label: "Tags", type: "text", icon: "ti-tag", active: true, read_only: false, many: true },
        { id: "author", label: "Author", type: "record", icon: "ti-user", active: true, read_only: false, many: false, filter_colguid: contacts.getGuid() }
      ],
      views: [
        {
          id: "all",
          label: "All Bookmarks",
          description: "List of all clipped bookmarks",
          icon: "ti-list",
          type: "overview",
          shown: true,
          read_only: false,
          field_ids: ["status", "site", "url", "saved_at", "tags", "author"],
          sort_field_id: "saved_at",
          sort_dir: "desc"
        }
      ],
      managed: { fields: true, views: true, sidebar: true },
      home: false
    }));

    return { bookmarks, contacts };
  }

  // Generic helper to get or create and provision a collection
  async getOrCreateCollection(name, configTemplateCreator) {
    const collections = await this.data.getAllCollections();
    let col = collections.find(c => c.getName() === name);
    
    if (!col) {
      console.log(`Clipper setup: creating collection ${name}...`);
      col = await this.data.createCollection();
      if (!col) throw new Error(`Failed to create collection: ${name}`);
    }

    const templateConf = configTemplateCreator(col.getGuid());
    const existingConf = col.getConfiguration();
    let needsUpdate = false;

    // Self-healing check for name and icon updates
    if (existingConf.name !== name || existingConf.icon !== templateConf.icon) {
      needsUpdate = true;
    }

    // Merge missing fields
    const fields = [...(existingConf.fields || [])];
    templateConf.fields.forEach(targetField => {
      const existingField = fields.find(f => f.id === targetField.id);
      if (!existingField) {
        fields.push(targetField);
        needsUpdate = true;
      } else {
        if (!existingField.active || existingField.type !== targetField.type) {
          existingField.active = true;
          existingField.type = targetField.type;
          needsUpdate = true;
        }
        // Sync `many` flag so multi-value fields added later get fixed
        if (!!existingField.many !== !!targetField.many) {
          existingField.many = !!targetField.many;
          needsUpdate = true;
        }
      }
    });

    // Merge missing views
    const views = [...(existingConf.views || [])];
    templateConf.views.forEach(targetView => {
      const existingView = views.find(v => v.id === targetView.id);
      if (!existingView) {
        views.push(targetView);
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      const newConf = {
        ...existingConf,
        name,
        item_name: templateConf.item_name,
        icon: templateConf.icon,
        fields,
        views,
        managed: templateConf.managed,
        home: templateConf.home
      };
      await col.saveConfiguration(newConf);
      console.log(`Clipper setup: configured collection schema for ${name}`);
    }

    return col;
  }

  // Action: Save Full Web Page / Article
  async saveArticle(payload) {
    const { bookmarks } = await this.ensureCollections();

    // Check if a record with this URL already exists
    const allRecords = await bookmarks.getAllRecords();
    let record = allRecords.find(r => r.prop("url")?.text() === payload.url);
    let isNew = false;

    if (!record) {
      isNew = true;
      // 1. Create a new bookmark record (sync — returns guid immediately)
      const recordGuid = bookmarks.createRecord(payload.title);
      if (!recordGuid) throw new Error("Failed to create bookmark record in Thymer.");

      // Fetch fresh record list so the newly created record is available
      const refreshedRecords = await bookmarks.getAllRecords();
      record = refreshedRecords.find(r => r.guid === recordGuid);
      if (!record) throw new Error("Failed to load newly created bookmark record.");
      record.prop("url")?.set(payload.url);
    } else if (payload.title && payload.title !== record.getName()) {
      // Update record title when user edited it in the extension popup
      record.prop("Title")?.set(payload.title);
    }

    // 2. Set/Update fields (guard each prop call in case field doesn't exist)
    record.prop("site")?.set(payload.siteName || "");
    record.prop("excerpt")?.set(payload.excerpt || "");
    record.prop("word_count")?.set(payload.wordCount || 0);

    if (payload.savedAt) {
      record.prop("saved_at")?.setFromDate(new Date(payload.savedAt));
    }

    // Default Status Choice (only for new bookmarks, preserve user edits for old ones)
    if (isNew) {
      record.prop("status")?.setChoice("Unread");
    }

    // Add/merge tags if provided
    if (payload.tags && payload.tags.length > 0) {
      record.prop("tags")?.set(payload.tags);
    }

    // Resolve and link Author relation
    if (payload.author) {
      const authorGuid = await this.resolveContact(payload.author);
      if (authorGuid) {
        record.prop("author")?.set(authorGuid);
      }
    }

    // 3. Populate or Update Note Content body from generic HTML
    if (payload.htmlContent) {
      const lineItems = await record.getLineItems();
      
      // Locate the Highlights heading and quotes to preserve
      const highlightsHeading = lineItems.find(
        item => item.type === "heading" &&
        item.segments &&
        item.segments.some(seg => seg.text === "Highlights")
      );
      
      const quoteItems = lineItems.filter(item => item.type === "quote");
      
      // Determine the anchor after which the Title heading should be created
      let insertAnchor = null;
      if (highlightsHeading) {
        insertAnchor = highlightsHeading;
        const nextIdx = lineItems.indexOf(highlightsHeading) + 1;
        if (nextIdx < lineItems.length && lineItems[nextIdx].type === "hr") {
          insertAnchor = lineItems[nextIdx];
        }
      }
      if (quoteItems.length > 0) {
        const lastQuote = quoteItems[quoteItems.length - 1];
        insertAnchor = lastQuote;
        
        // Find if the last quote has a child note item
        const childNotes = lineItems.filter(item => item.parent_guid === lastQuote.guid);
        if (childNotes.length > 0) {
          insertAnchor = childNotes[childNotes.length - 1];
        }
      }

      // Collect GUIDs of all items to preserve
      const preservedGuids = new Set();
      if (highlightsHeading) {
        preservedGuids.add(highlightsHeading.guid);
        const nextIdx = lineItems.indexOf(highlightsHeading) + 1;
        if (nextIdx < lineItems.length && lineItems[nextIdx].type === "hr") {
          preservedGuids.add(lineItems[nextIdx].guid);
        }
      }
      quoteItems.forEach(q => {
        preservedGuids.add(q.guid);
        const children = lineItems.filter(item => item.parent_guid === q.guid);
        children.forEach(c => preservedGuids.add(c.guid));
      });

      // Delete non-preserved line items (old scraped body content)
      for (let i = lineItems.length - 1; i >= 0; i--) {
        const item = lineItems[i];
        if (!preservedGuids.has(item.guid)) {
          try {
            await item.delete();
          } catch (e) {
            console.warn("Failed to delete stale line item:", e);
          }
        }
      }

      // Create the article Title heading right after the Highlights block
      const titleHeading = await record.createLineItem(
        null,
        insertAnchor, // sibling (null prepends at the top if no highlights exist)
        "heading",
        [{ type: "text", text: payload.title || "Scraped Article" }],
        null
      );
      if (titleHeading) {
        await titleHeading.setHeadingSize(1);
      }

      // Insert the HTML body content right after the Title heading
      await record.insertFromHTML(payload.htmlContent, null, titleHeading || insertAnchor);

      // Insert images extracted from the page (Twitter media, LinkedIn post photos, og:image, etc.)
      if (payload.images && payload.images.length > 0) {
        // We need a fresh line item list to find the last inserted item to anchor images after body
        const freshItems = await record.getLineItems();
        const nonPreserved = freshItems.filter(item => !preservedGuids.has(item.guid));
        let imageAnchor = nonPreserved.length > 0 ? nonPreserved[nonPreserved.length - 1] : (titleHeading || insertAnchor);

        for (const imgInfo of payload.images) {
          try {
            // Fetch the image cross-origin; Twitter/X pbs.twimg.com and LinkedIn media are public CDNs
            const response = await fetch(imgInfo.src, { mode: 'cors' });
            if (!response.ok) continue;

            const arrayBuffer = await response.arrayBuffer();
            const contentType = response.headers.get('content-type') || 'image/jpeg';
            const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
            const filename = imgInfo.alt
              ? imgInfo.alt.replace(/[^a-z0-9]/gi, '_').substring(0, 40) + '.' + ext
              : `image_${Date.now()}.${ext}`;

            const file = new File([arrayBuffer], filename, { type: contentType });
            const blob = await this.data.uploadBlob(file);
            if (!blob) continue;

            const imgLi = await record.createLineItem(null, imageAnchor, 'image', null, null);
            if (imgLi) {
              await imgLi.setBlob(blob);
              imageAnchor = imgLi; // chain next image after this one
            }
          } catch (imgErr) {
            console.warn('Thymer Clipper: skipped image (fetch/upload failed):', imgInfo.src, imgErr.message);
          }
        }
      }
    }

    return {
      guid: record.guid,
      collectionGuid: bookmarks.getGuid(),
      url: payload.url,
      isNew
    };
  }

  // Action: Add Highlight selection and trigger Daily Journal transclusion
  async addHighlight(payload) {
    const { bookmarks } = await this.ensureCollections();

    // 1. Retrieve or lazily create a Bookmark record for this website
    const records = await bookmarks.getAllRecords();
    let record = records.find(r => r.prop("url")?.text() === payload.url);

    if (!record) {
      const recordGuid = bookmarks.createRecord(payload.title || "Untitled Snippets");
      if (!recordGuid) throw new Error("Failed to create bookmark record for highlight.");
      // Re-fetch to get the new record object
      const refreshed = await bookmarks.getAllRecords();
      record = refreshed.find(r => r.guid === recordGuid);
      if (!record) throw new Error("Failed to load newly created bookmark record for highlight.");
      record.prop("url")?.set(payload.url);
      record.prop("status")?.setChoice("Unread");
      record.prop("saved_at")?.setFromDate(new Date());

      // Resolve and link Author relation on lazy bookmark creation
      if (payload.author) {
        const authorGuid = await this.resolveContact(payload.author);
        if (authorGuid) {
          record.prop("author")?.set(authorGuid);
        }
      }
    }

    // 2. Locate or create the "# Highlights" heading at the very top of the Bookmark record
    const bookmarkLineItems = await record.getLineItems();
    let highlightsHeading = bookmarkLineItems.find(
      item => item.type === "heading" &&
      item.segments &&
      item.segments.some(seg => seg.text === "Highlights")
    );

    if (!highlightsHeading) {
      // Prepend heading at the top (null sibling inserts at top)
      highlightsHeading = await record.createLineItem(
        null,
        null,
        "heading",
        [{ type: "text", text: "Highlights" }],
        null
      );
      if (highlightsHeading) {
        await highlightsHeading.setHeadingSize(1);
        // Add a separator line right after the Highlights heading
        await record.createLineItem(null, highlightsHeading, "hr", null, null);
      }
    }

    // Find the insertion anchor for the new highlight:
    // We want to insert it after the Highlights heading (or its hr separator),
    // but if there are previous highlights, we place it after the last highlight quote or its note.
    let afterLi = highlightsHeading;
    if (bookmarkLineItems.length > 0) {
      const nextIdx = bookmarkLineItems.indexOf(highlightsHeading) + 1;
      if (nextIdx < bookmarkLineItems.length && bookmarkLineItems[nextIdx].type === "hr") {
        afterLi = bookmarkLineItems[nextIdx];
      }
      const quoteItems = bookmarkLineItems.filter(item => item.type === "quote");
      if (quoteItems.length > 0) {
        afterLi = quoteItems[quoteItems.length - 1];
        const childNotes = bookmarkLineItems.filter(item => item.parent_guid === afterLi.guid);
        if (childNotes.length > 0) {
          afterLi = childNotes[childNotes.length - 1];
        }
      }
    }

    // 3. Create the quote line item directly at the top level
    const quoteLi = await record.createLineItem(null, afterLi, "quote", [{ type: "text", text: payload.text }], null);
    if (!quoteLi) throw new Error("Failed to create quote line item.");

    // Save selectors to item metadata properties on the quote line
    await quoteLi.setMetaProperties({
      anchor: payload.selector,
      color: payload.color || "yellow",
      pageUrl: payload.url
    });

    // 4. Create the note line item nested under the quote line
    const noteLi = await record.createLineItem(quoteLi, null, "text", [{ type: "text", text: payload.note || "" }], null);

    // 5. Perform Daily Journal Transclusion
    try {
      const collections = await this.data.getAllCollections();
      const journalCol = collections.find(c => c.isJournalPlugin());
      
      if (journalCol) {
        const users = this.data.getActiveUsers();
        if (users && users.length > 0) {
          const todayRecord = await journalCol.getJournalRecord(
            users[0], 
            DateTime.parseDateTimeString("today")
          );

          if (todayRecord) {
            const lineItems = await todayRecord.getLineItems();
            
            // Search for existing "Web Highlights" heading
            let headingItem = lineItems.find(
              item => item.type === "heading" && 
              item.segments && 
              item.segments.some(seg => seg.text === "Web Highlights")
            );

            // Create heading if it does not exist
            if (!headingItem) {
              headingItem = await todayRecord.createLineItem(
                null, 
                null, 
                "heading", 
                [{ type: "text", text: "Web Highlights" }], 
                null
              );
              if (headingItem) {
                await headingItem.setHeadingSize(2);
              }
            }

            // Find if there is already a parent link for this bookmark record in today's record
            let parentItem = lineItems.find(item => {
              if (!item.segments) return false;
              return item.segments.some(seg => {
                if (seg.type !== "ref" || !seg.text) return false;
                const g = (typeof seg.text === "object" && seg.text !== null) ? seg.text.guid : seg.text;
                return g === record.guid;
              });
            });

            // Create parent Bookmark record reference if not found
            if (!parentItem && headingItem) {
              parentItem = await todayRecord.createLineItem(
                null,
                headingItem,
                "text",
                [{ type: "ref", text: { guid: record.guid } }],
                null
              );
            }

            // Create highlight transclusion indented under parent Bookmark link pointing to the quote GUID
            if (parentItem) {
              const journalQuote = await todayRecord.createLineItem(
                parentItem,
                null,
                "quote",
                [{ type: "ref", text: { guid: quoteLi.guid, title: payload.text } }],
                null
              );
              if (journalQuote) {
                await todayRecord.createLineItem(
                  journalQuote,
                  null,
                  "text",
                  [{ type: "text", text: payload.note || "" }],
                  null
                );
              }
            }
          }
        }
      }
    } catch (journalErr) {
      console.warn("Failed to transclude highlight onto Daily Journal:", journalErr);
    }

    return {
      highlightGuid: quoteLi.guid,
      bookmarkGuid: record.guid
    };
  }

  // Action: Delete a highlight and cleanup Daily Journal transclusions
  async deleteHighlight(payload) {
    const { bookmarks } = await this.ensureCollections();

    // 1. Find the Bookmark record
    const records = await bookmarks.getAllRecords();
    const record = records.find(r => r.prop("url")?.text() === payload.url);
    if (!record) return { success: false, error: "Bookmark record not found" };

    // Get all line items in the bookmark
    const lineItems = await record.getLineItems();
    const targetGuid = payload.guid;

    // Locate the quote line item
    const quoteLi = lineItems.find(item => item.guid === targetGuid);
    if (quoteLi) {
      // 2. Delete all children of this quote line first (e.g. nested note lines)
      const children = lineItems.filter(item => item.parent_guid === targetGuid);
      for (const child of children) {
        try {
          await child.delete();
        } catch (e) {
          console.warn("Failed to delete child line item:", e);
        }
      }

      // 3. Delete the quote line itself
      try {
        await quoteLi.delete();
      } catch (e) {
        console.warn("Failed to delete highlight quote line:", e);
        return { success: false, error: "Failed to delete quote line" };
      }
    }

    // 4. Clean up Daily Journal transclusions
    try {
      const collections = await this.data.getAllCollections();
      const journalCol = collections.find(c => c.isJournalPlugin());
      if (journalCol) {
        const users = this.data.getActiveUsers();
        if (users && users.length > 0) {
          const todayRecord = await journalCol.getJournalRecord(
            users[0],
            DateTime.parseDateTimeString("today")
          );

          if (todayRecord) {
            const journalItems = await todayRecord.getLineItems();
            
            // Find any transclusion line item pointing to targetGuid
            const transclusionItem = journalItems.find(item => 
              item.segments && 
              item.segments.some(seg => seg.type === "ref" && seg.text && seg.text.guid === targetGuid)
            );

            if (transclusionItem) {
              const parentGuid = transclusionItem.parent_guid;
              await transclusionItem.delete();

              // If the parent article link has no other highlights left today, delete the parent article link too!
              if (parentGuid) {
                const remainingChildren = journalItems.filter(item => 
                  item.parent_guid === parentGuid && 
                  item.guid !== transclusionItem.guid
                );
                
                if (remainingChildren.length === 0) {
                  const parentItem = journalItems.find(item => item.guid === parentGuid);
                  if (parentItem) {
                    const headingGuid = parentItem.parent_guid;
                    await parentItem.delete();

                    // If "Web Highlights" heading has no other article links left today, delete the heading too!
                    if (headingGuid) {
                      const headingChildren = journalItems.filter(item => 
                        item.parent_guid === headingGuid && 
                        item.guid !== parentItem.guid
                      );
                      if (headingChildren.length === 0) {
                        const headingItem = journalItems.find(item => item.guid === headingGuid);
                        if (headingItem) {
                          await headingItem.delete();
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (journalErr) {
      console.warn("Failed to cleanup journal transclusion:", journalErr);
    }

    return { success: true };
  }

  // Action: Update a highlight's note in the bookmark record and daily journal
  async updateHighlightNote(payload) {
    const { guid, note, url } = payload;
    const { bookmarks } = await this.ensureCollections();

    // 1. Locate the quote line item in the Bookmark record
    const records = await bookmarks.getAllRecords();
    const record = records.find(r => r.prop("url")?.text() === url);
    if (!record) {
      return { success: false, error: "Bookmark record not found for URL" };
    }

    const lineItems = await record.getLineItems();
    const quoteLi = lineItems.find(item => item.guid === guid);
    if (!quoteLi) {
      return { success: false, error: "Quote line item not found for guid" };
    }

    // Update note child in the Bookmark record
    const children = lineItems.filter(item => item.parent_guid === quoteLi.guid);
    const noteLi = children.find(item => item.type === "text");
    if (noteLi) {
      await noteLi.setSegments([{ type: "text", text: note }]);
    } else {
      await record.createLineItem(quoteLi, null, "text", [{ type: "text", text: note }], null);
    }

    // 2. Locate and update/create today's Daily Journal transcluded note child
    try {
      const collections = await this.data.getAllCollections();
      const journalCol = collections.find(c => c.isJournalPlugin());
      if (journalCol) {
        const users = this.data.getActiveUsers();
        if (users && users.length > 0) {
          const todayRecord = await journalCol.getJournalRecord(
            users[0],
            DateTime.parseDateTimeString("today")
          );

          if (todayRecord) {
            const journalItems = await todayRecord.getLineItems();
            
            // Find the transcluded quote item pointing to guid
            const journalQuote = journalItems.find(item => 
              item.segments && 
              item.segments.some(seg => seg.type === "ref" && seg.text && seg.text.guid === guid)
            );

            if (journalQuote) {
              const journalQuoteChildren = journalItems.filter(item => item.parent_guid === journalQuote.guid);
              const journalNote = journalQuoteChildren.find(item => item.type === "text");
              if (journalNote) {
                await journalNote.setSegments([{ type: "text", text: note }]);
              } else {
                await todayRecord.createLineItem(journalQuote, null, "text", [{ type: "text", text: note }], null);
              }
            }
          }
        }
      }
    } catch (journalErr) {
      console.warn("Failed to sync note edit to journal transclusion:", journalErr);
    }

    return { success: true };
  }

  // Action: Retrieve all highlights for a specific URL
  async getPageHighlights(payload) {
    try {
      const { bookmarks } = await this.ensureCollections();
      const records = await bookmarks.getAllRecords();
      const record = records.find(r => r.prop("url")?.text() === payload.url);
      
      if (!record) {
        return { highlights: [], workspaceGuid: this.getWorkspaceGuid() };
      }

      const lineItems = await record.getLineItems();
      const highlights = [];

      for (const item of lineItems) {
        if (item.props && item.props.anchor) {
          let textContent = "";
          if (item.segments && item.segments.length > 0) {
            textContent = item.segments
              .map(seg => typeof seg.text === "string" ? seg.text : (seg.text && (seg.text.title || seg.text.text) || ""))
              .join("");
          }

          // Fetch nested note child text if it exists
          const children = lineItems.filter(child => child.parent_guid === item.guid);
          const noteChild = children.find(child => child.type === "text");
          const noteText = noteChild ? (noteChild.segments && noteChild.segments.map(s => typeof s.text === "string" ? s.text : (s.text && s.text.text || "")).join("") || "") : "";

          highlights.push({
            guid: item.guid,
            text: textContent || "Highlight",
            anchor: item.props.anchor,
            color: item.props.color || "yellow",
            note: noteText,
            recordGuid: record.guid
          });
        }
      }

      return {
        highlights,
        workspaceGuid: this.getWorkspaceGuid()
      };
    } catch (err) {
      console.warn("Failed to retrieve highlights:", err);
      return { highlights: [], workspaceGuid: this.getWorkspaceGuid(), error: err.message };
    }
  }

  // Helper to find or create a Contact record from author metadata
  async resolveContact(author) {
    if (!author || (!author.name && !author.handle)) return null;

    try {
      const { contacts } = await this.ensureCollections();
      const contactsRecords = await contacts.getAllRecords();

      // Clean handles for comparison (e.g. "@sketchplanator" -> "sketchplanator")
      const cleanHandle = (h) => h ? h.replace(/^@/, "").trim().toLowerCase() : "";
      const targetHandle = cleanHandle(author.handle);
      
      // Normalize names to strip honorifics (Dr., Prof., etc.) and clean spacing
      const normalizeName = (name) => {
        if (!name) return "";
        return name
          .replace(/^(dr\.|dr|prof\.|prof|mr\.|mr|ms\.|ms|mrs\.)\s+/i, "")
          .replace(/\b(phd|md|m\.d\.)\b/i, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      };
      
      const targetName = normalizeName(author.name);
      const targetProfileUrl = author.profileUrl ? author.profileUrl.trim().toLowerCase() : "";

      // 1. Search for existing contact by handle, name, or profile URL
      let existingContact = contactsRecords.find(r => {
        const h = r.prop("handle")?.text();
        if (h && targetHandle && cleanHandle(h) === targetHandle) return true;

        const name = r.getName();
        if (name && targetName && normalizeName(name) === targetName) return true;

        const pUrl = r.prop("profile_url")?.text();
        if (pUrl && targetProfileUrl && pUrl.trim().toLowerCase() === targetProfileUrl) return true;

        return false;
      });

      if (existingContact) {
        // Self-healing updates for missing metadata fields
        let needsSave = false;
        
        if (author.handle && !existingContact.prop("handle")?.text()) {
          existingContact.prop("handle")?.set(author.handle);
          needsSave = true;
        }
        if (author.profileUrl && !existingContact.prop("profile_url")?.text()) {
          existingContact.prop("profile_url")?.set(author.profileUrl);
          needsSave = true;
        }
        if (author.platform && !existingContact.prop("platform")?.choice()) {
          existingContact.prop("platform")?.setChoice(author.platform);
          needsSave = true;
        }
        
        return existingContact.guid;
      }

      // 2. No matching contact found, create a new one
      const contactName = author.name || author.handle || "Unknown Author";
      const contactGuid = contacts.createRecord(contactName);
      if (!contactGuid) return null;

      // Fetch refreshed records list to retrieve the object
      const refreshed = await contacts.getAllRecords();
      const newContact = refreshed.find(r => r.guid === contactGuid);
      
      if (newContact) {
        if (author.handle) newContact.prop("handle")?.set(author.handle);
        if (author.profileUrl) newContact.prop("profile_url")?.set(author.profileUrl);
        if (author.platform) newContact.prop("platform")?.setChoice(author.platform);
        return newContact.guid;
      }
    } catch (e) {
      console.warn("Failed to resolve contact for author:", author, e);
    }

    return null;
  }

  // Get all unique tags from bookmarks for autocomplete;
  // also return existing tags for the given URL so popup can pre-fill chips
  async getExistingTags(payload) {
    const { bookmarks } = await this.ensureCollections();
    const allRecords = await bookmarks.getAllRecords();
    const tagsSet = new Set();
    let pageTags = [];
    for (const r of allRecords) {
      const vals = r.prop("tags")?.texts() || [];
      vals.forEach(t => {
        const trimmed = t.trim();
        if (trimmed) tagsSet.add(trimmed);
      });
      // If this record matches the current page URL, capture its tags
      if (payload && payload.url && r.prop("url")?.text() === payload.url) {
        pageTags = vals.map(t => t.trim()).filter(Boolean);
      }
    }
    return { tags: Array.from(tagsSet).sort(), pageTags };
  }
}
