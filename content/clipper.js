// content/clipper.js - Clipper script for text selection, anchoring, highlights & overlays
// v1.2607.417.10

class ThymerClipper {
  constructor() {
    this.shadowRoot = null;
    this.activeRange = null;
    this.menuElement = null;
    this.workspaceGuid = null;

    this.COLORS = {
      yellow: { hex: "#FDE047", rgb: "253, 224, 71" },
      green: { hex: "#86EFAC", rgb: "134, 239, 172" },
      blue: { hex: "#93C5FD", rgb: "147, 197, 253" },
      pink: { hex: "#F48FB1", rgb: "244, 143, 177" },
      orange: { hex: "#FDBA74", rgb: "253, 186, 116" }
    };

    this.retryTimer = null;

    this.initShadowDom();
    this.listen();
    this.setupSelectionListener();
    this.loadExistingHighlights();
    this.setupSpaUrlListener();
  }

  // Monitor SPA route changes (X/Twitter, LinkedIn) and reload highlights
  setupSpaUrlListener() {
    this.currentUrl = this.getNormalizedUrl(window.location.href);
    this.spaTimer = setInterval(() => {
      const normalizedCurrent = this.getNormalizedUrl(window.location.href);
      if (normalizedCurrent !== this.currentUrl) {
        this.currentUrl = normalizedCurrent;
        
        if (this.retryTimer) {
          clearInterval(this.retryTimer);
          this.retryTimer = null;
        }
        
        // Remove old visual highlight markers
        const marks = document.querySelectorAll('mark.thymer-highlight');
        marks.forEach(mark => {
          const parent = mark.parentNode;
          if (parent) {
            while (mark.firstChild) {
              parent.insertBefore(mark.firstChild, mark);
            }
            mark.remove();
          }
        });
        document.body.normalize();

        // Load fresh highlights for the new URL path
        this.loadExistingHighlights();
      }
    }, 1000);
  }

  // Normalize URLs to ignore subroutes or tracking query parameters (Twitter query params, LinkedIn shares, etc.)
  getNormalizedUrl(urlStr) {
    try {
      const url = new URL(urlStr);
      const hostname = url.hostname.toLowerCase();
      
      if (hostname.includes("youtube.com")) {
        const videoId = url.searchParams.get("v");
        return `https://www.youtube.com/watch?v=${videoId || ""}`;
      }
      
      if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
        const match = url.pathname.match(/^(\/[^\/]+\/status\/\d+)/);
        if (match) {
          return `https://x.com${match[1]}`;
        }
      }
      
      if (hostname.includes("linkedin.com")) {
        return `https://www.linkedin.com${url.pathname}`.replace(/\/$/, "");
      }
      
      // Generic fallback: strip search parameters and hashes
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch (e) {
      return urlStr;
    }
  }

  // Initialize closed Shadow DOM container for Clipper UI elements
  initShadowDom() {
    let container = document.querySelector('thymer-clipper-container');
    if (!container) {
      container = document.createElement('thymer-clipper-container');
      document.body.appendChild(container);
      this.shadowRoot = container.attachShadow({ mode: 'closed' });
      
      const style = document.createElement('style');
      style.textContent = `
        .thymer-toast {
          position: fixed;
          bottom: 24px;
          right: 24px;
          padding: 12px 24px;
          background: rgba(17, 24, 39, 0.9);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: #F9FAFB;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          font-weight: 500;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          gap: 8px;
          transform: translateY(100px);
          opacity: 0;
          transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease;
        }
        .thymer-toast.show {
          transform: translateY(0);
          opacity: 1;
        }
        .thymer-toast.error {
          border-left: 4px solid #EF4444;
          background: rgba(254, 242, 242, 0.95);
          color: #991B1B;
        }
        .thymer-toast.success {
          border-left: 4px solid #10B981;
          background: rgba(240, 253, 250, 0.95);
          color: #065F46;
        }

        /* Floating Selection Menu */
        .thymer-selection-menu {
          position: absolute;
          z-index: 2147483646;
          background: rgba(17, 24, 39, 0.95);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.6);
          transition: opacity 0.2s ease, transform 0.2s ease;
          opacity: 0;
          transform: scale(0.9);
          pointer-events: none;
          width: 220px;
        }
        .thymer-selection-menu.show {
          opacity: 1;
          transform: scale(1);
          pointer-events: auto;
        }
        .thymer-highlight-menu {
          width: 140px !important;
          border-radius: 9999px !important;
          padding: 6px 12px !important;
          flex-direction: row !important;
          align-items: center !important;
        }
        .color-picker-row {
          display: flex;
          align-items: center;
          gap: 10px;
          justify-content: center;
        }
        .color-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid transparent;
          cursor: pointer;
          transition: transform 0.2s ease, border-color 0.2s ease;
          box-shadow: inset 0 0 0 2px rgba(17, 24, 39, 0.5);
        }
        .color-dot:hover {
          transform: scale(1.2);
          border-color: #FFFFFF;
        }
        .note-input-row {
          display: flex;
          width: 100%;
        }
        .note-input-row textarea {
          width: 100%;
          min-height: 44px;
          max-height: 120px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 8px 10px;
          color: #FFFFFF;
          font-size: 11px;
          outline: none;
          box-sizing: border-box;
          font-family: inherit;
          resize: none;
          overflow-y: auto;
          line-height: 1.4;
          transition: border-color 0.2s ease, background 0.2s ease;
        }
        .note-input-row textarea:focus {
          border-color: #C084FC;
          background: rgba(255, 255, 255, 0.08);
        }
        .menu-divider {
          width: 100%;
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          margin: 2px 0;
        }
        .menu-btn {
          background: transparent;
          border: none;
          color: #9CA3AF;
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 8px;
          border-radius: 6px;
          transition: color 0.2s ease, background 0.2s ease;
        }
        .menu-btn:hover {
          color: #FFFFFF;
          background: rgba(255, 255, 255, 0.05);
        }
      `;
      this.shadowRoot.appendChild(style);

      // Create selection menu element
      this.menuElement = document.createElement('div');
      this.menuElement.className = 'thymer-selection-menu';
      
      let innerHTML = `
        <div class="color-picker-row">
      `;
      Object.keys(this.COLORS).forEach(color => {
        innerHTML += `<div class="color-dot" data-color="${color}" style="background-color: ${this.COLORS[color].hex};" title="Highlight ${color}"></div>`;
      });
      innerHTML += `
        </div>
        <div class="note-input-row">
          <textarea id="clipper-note-input" placeholder="Add a note to highlight..." rows="2"></textarea>
        </div>
        <div class="menu-divider"></div>
        <button class="menu-btn" id="clipper-save-btn" style="width: 100%;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          Save Page
        </button>
      `;
      this.menuElement.innerHTML = innerHTML;
      this.shadowRoot.appendChild(this.menuElement);

      // Add auto-expand behavior for textarea
      const textarea = this.menuElement.querySelector('#clipper-note-input');
      if (textarea) {
        textarea.addEventListener('input', () => {
          textarea.style.height = 'auto';
          textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
        });
      }

      // Add click handlers for dots
      this.menuElement.querySelectorAll('.color-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
          const color = e.target.getAttribute('data-color');
          const noteInput = this.menuElement.querySelector('#clipper-note-input');
          const note = noteInput ? noteInput.value.trim() : "";
          this.saveHighlightSelection(color, note);
          if (noteInput) {
            noteInput.value = ""; 
            noteInput.style.height = 'auto';
          }
        });
      });

      // Save page click
      this.menuElement.querySelector('#clipper-save-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB_INFO" }).then(tab => {
          if (tab && tab.id) {
            chrome.runtime.sendMessage({
              type: "SAVE_ARTICLE",
              payload: this.extractPageMetadata(),
              workspaceGuid: this.workspaceGuid
            }).then(res => {
              if (res && !res.error) {
                this.showToast("Saved page to Thymer ✓");
              } else {
                this.showToast(`Save failed: ${res?.error || 'Unknown error'}`, true);
              }
            });
          }
        });
        this.hideSelectionMenu();
      });

      // Create highlight modification menu element
      this.highlightMenuElement = document.createElement('div');
      this.highlightMenuElement.className = 'thymer-selection-menu thymer-edit-card';
      this.highlightMenuElement.innerHTML = `
        <div class="note-input-row">
          <textarea id="clipper-edit-note-input" placeholder="Type a note..." rows="2"></textarea>
        </div>
        <div class="menu-divider"></div>
        <div style="display: flex; gap: 8px; width: 100%;">
          <button class="menu-btn" id="clipper-save-note-btn" style="flex: 1; color: #C084FC;">Save Note</button>
          <button class="menu-btn" id="clipper-delete-hl-btn" style="color: #F87171; display: flex; align-items: center; gap: 4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete
          </button>
        </div>
      `;
      this.shadowRoot.appendChild(this.highlightMenuElement);

      const editInput = this.highlightMenuElement.querySelector('#clipper-edit-note-input');
      if (editInput) {
        editInput.addEventListener('input', () => {
          editInput.style.height = 'auto';
          editInput.style.height = Math.min(editInput.scrollHeight, 120) + 'px';
        });
      }

      this.highlightMenuElement.querySelector('#clipper-save-note-btn').addEventListener('click', () => {
        if (this.activeHighlightMark) {
          const guid = this.activeHighlightMark.getAttribute('data-guid');
          const newNote = editInput ? editInput.value.trim() : "";
          this.updateHighlightNote(guid, newNote);
        }
        this.hideHighlightMenu();
      });

      this.highlightMenuElement.querySelector('#clipper-delete-hl-btn').addEventListener('click', () => {
        if (this.activeHighlightMark) {
          const guid = this.activeHighlightMark.getAttribute('data-guid');
          this.deleteHighlight(guid);
        }
        this.hideHighlightMenu();
      });
    }
  }

  listen() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case "CLIPPER_EXTRACT_CONTENT":
          this.extractPageMetadataAsync().then(sendResponse);
          return true; // Keep channel open for async response

        case "CLIPPER_SHOW_TOAST":
          this.showToast(message.message, message.isError);
          sendResponse({ success: true });
          break;

        case "CLIPPER_TRIGGER_HIGHLIGHT":
          this.workspaceGuid = message.workspaceGuid || null;
          this.saveHighlightSelection("yellow");
          sendResponse({ success: true });
          break;
      }
    });
  }

  // Setup text selection events to position floating toolbar
  setupSelectionListener() {
    const handleSelection = () => {
      // Prevent hiding selection menu if user is focusing/typing inside any note input
      if (this.shadowRoot && this.shadowRoot.activeElement && 
          (this.shadowRoot.activeElement.id === 'clipper-note-input' || this.shadowRoot.activeElement.id === 'clipper-edit-note-input')) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        this.hideSelectionMenu();
        return;
      }

      const range = selection.getRangeAt(0);
      const text = range.toString().trim();

      if (text.length > 0) {
        this.activeRange = range;
        this.showSelectionMenu(range);
      } else {
        this.hideSelectionMenu();
      }
    };

    let mouseUpTimeout = null;
    document.addEventListener("mouseup", (e) => {
      if (mouseUpTimeout) clearTimeout(mouseUpTimeout);
      
      // Delay to let click sequences (double click for word, triple click for sentence) settle
      const delay = (e.detail >= 2) ? 300 : 150;
      mouseUpTimeout = setTimeout(handleSelection, delay);
    });

    document.addEventListener("keyup", (e) => {
      // Ignore key events if focused on input/textarea
      if (this.shadowRoot && this.shadowRoot.activeElement && 
          (this.shadowRoot.activeElement.id === 'clipper-note-input' || this.shadowRoot.activeElement.id === 'clipper-edit-note-input')) {
        return;
      }
      handleSelection();
    });

    // Hide menu on clicking elsewhere
    document.addEventListener("mousedown", (e) => {
      if (e.target.tagName === 'THYMER-CLIPPER-CONTAINER') return;
      this.hideSelectionMenu();
    });

    // Detect click on highlight mark to show delete menu
    document.addEventListener("click", (e) => {
      const mark = e.target.closest('mark.thymer-highlight');
      if (mark) {
        e.preventDefault();
        e.stopPropagation();
        this.activeHighlightMark = mark;
        this.showHighlightMenu(mark);
      } else {
        if (e.target.tagName !== 'THYMER-CLIPPER-CONTAINER') {
          this.hideHighlightMenu();
        }
      }
    });
  }

  showSelectionMenu(range) {
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Position above selection center
    const menuWidth = 190;
    const menuHeight = 36;
    
    let top = rect.top + window.scrollY - menuHeight - 10;
    let left = rect.left + window.scrollX + (rect.width / 2) - (menuWidth / 2);

    // Prevent off-screen positioning
    if (left < 10) left = 10;
    if (top < 10) top = rect.bottom + window.scrollY + 10; // position below selection if no top room

    this.menuElement.style.top = `${top}px`;
    this.menuElement.style.left = `${left}px`;
    this.menuElement.classList.add('show');
  }

  hideSelectionMenu() {
    if (this.menuElement) {
      this.menuElement.classList.remove('show');
    }
  }

  showHighlightMenu(mark) {
    const rect = mark.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Retrieve note from data-note attribute
    const note = mark.getAttribute('data-note') || "";
    const textarea = this.highlightMenuElement.querySelector('#clipper-edit-note-input');
    if (textarea) {
      textarea.value = note;
      textarea.style.height = 'auto';
      // Recalculate size to fit content
      setTimeout(() => {
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      }, 0);
    }

    const menuWidth = 220;
    const menuHeight = 90; // approximate height for card
    
    let top = rect.top + window.scrollY - menuHeight - 10;
    let left = rect.left + window.scrollX + (rect.width / 2) - (menuWidth / 2);

    if (left < 10) left = 10;
    if (top < 10) top = rect.bottom + window.scrollY + 10;

    this.highlightMenuElement.style.top = `${top}px`;
    this.highlightMenuElement.style.left = `${left}px`;
    this.highlightMenuElement.classList.add('show');
  }

  hideHighlightMenu() {
    if (this.highlightMenuElement) {
      this.highlightMenuElement.classList.remove('show');
    }
    this.activeHighlightMark = null;
  }

  updateHighlightNote(guid, note) {
    chrome.runtime.sendMessage({
      type: "UPDATE_HIGHLIGHT_NOTE",
      payload: {
        guid: guid,
        note: note,
        url: this.getNormalizedUrl(window.location.href)
      },
      workspaceGuid: this.workspaceGuid
    }).then(res => {
      if (res && !res.error) {
        const marks = document.querySelectorAll(`mark[data-guid="${guid}"]`);
        marks.forEach(mark => {
          mark.setAttribute('data-note', note);
        });
        this.showToast("Note updated in Thymer ✓");
      } else {
        this.showToast(`Update failed: ${res?.error || 'Unknown error'}`, true);
      }
    }).catch(err => {
      this.showToast(`Error: ${err.message}`, true);
    });
  }

  deleteHighlight(guid) {
    chrome.runtime.sendMessage({
      type: "DELETE_HIGHLIGHT",
      payload: {
        guid: guid,
        url: this.getNormalizedUrl(window.location.href)
      },
      workspaceGuid: this.workspaceGuid
    }).then(res => {
      if (res && !res.error) {
        const marks = document.querySelectorAll(`mark[data-guid="${guid}"]`);
        marks.forEach(mark => {
          const parent = mark.parentNode;
          while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
          }
          mark.remove();
        });
        document.body.normalize();
        this.showToast("Highlight deleted from Thymer ✓");
      } else {
        this.showToast(`Delete failed: ${res?.error || 'Unknown error'}`, true);
      }
    }).catch(err => {
      this.showToast(`Error: ${err.message}`, true);
    });
  }

  // Load and restore page highlights from Thymer
  loadExistingHighlights() {
    chrome.runtime.sendMessage({
      type: "GET_PAGE_HIGHLIGHTS",
      url: this.getNormalizedUrl(window.location.href),
      workspaceGuid: this.workspaceGuid
    }).then(res => {
      if (res && res.payload && res.payload.highlights) {
        this.workspaceGuid = res.payload.workspaceGuid || null;
        
        if (this.retryTimer) {
          clearInterval(this.retryTimer);
          this.retryTimer = null;
        }

        let pending = [...res.payload.highlights];
        let attempts = 0;

        const attemptRestore = () => {
          attempts++;
          pending = pending.filter(hl => {
            const success = this.restoreHighlight(hl);
            return !success; // Keep retrying if failed
          });

          // Stop retrying if all are restored or we reached limit (10 attempts / 10s)
          if (pending.length === 0 || attempts >= 10) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
          }
        };

        // Try immediately
        attemptRestore();

        // If some failed, retry every 1 second
        if (pending.length > 0) {
          this.retryTimer = setInterval(attemptRestore, 1000);
        }
      }
    }).catch(err => console.warn("Failed to load existing highlights:", err));
  }

  // Restore highlight on page load using text quote matching
  restoreHighlight(hl) {
    if (!hl.anchor) return false;
    const { exact, prefix, suffix } = hl.anchor;
    if (!exact) return false;

    // Guard: check if already restored
    const existing = document.querySelector(`mark.thymer-highlight[data-guid="${hl.guid}"]`);
    if (existing) return true; // Treat as success/restored

    // On social platforms, scope the search to the primary content article to
    // avoid matching identical text in sidebar/recommended tweets.
    const hostname = window.location.hostname.toLowerCase();
    let rootEl = null;
    if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
      // Primary tweet article — the first [data-testid="tweet"] inside the thread
      rootEl = document.querySelector('[data-testid="primaryTweet"] article') ||
               document.querySelector('article[data-testid="tweet"]') ||
               document.querySelector('main article');
    } else if (hostname.includes("linkedin.com")) {
      rootEl = document.querySelector('.feed-shared-update-v2') ||
               document.querySelector('.update-components-text') ||
               document.querySelector('main article');
    }

    const range = this.findTextQuoteRange(exact, prefix, suffix, rootEl || document.body);
    if (range) {
      this.highlightRange(range, hl.color, hl.guid, hl.recordGuid, hl.note);
      return true;
    }
    return false; // Failed to locate right now
  }

  // Traverse DOM text nodes and find range matching context offset using unified visible-text indexing.
  // rootEl: optional container to scope the search (e.g. a tweet article). Falls back to document.body.
  findTextQuoteRange(exact, prefix, suffix, rootEl) {
    const searchRoot = rootEl || document.body;
    const textNodes = [];
    const textNodeRanges = [];
    let fullText = "";

    const collectTextNodes = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        if (text) {
          const start = fullText.length;
          fullText += text;
          const end = fullText.length;
          textNodes.push(node);
          textNodeRanges.push({ node, start, end });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const name = node.nodeName.toUpperCase();
        if (name === "SCRIPT" || name === "STYLE" || name === "NOSCRIPT" || name === "TEMPLATE" || node.tagName === "THYMER-CLIPPER-CONTAINER") {
          return;
        }
        try {
          const style = window.getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden") {
            return;
          }
        } catch (e) {}
        
        for (let child of node.childNodes) {
          collectTextNodes(child);
        }
      }
    };

    try {
      collectTextNodes(searchRoot);
    } catch (err) {
      // If scoped root fails, fall back to full body
      console.warn("Scoped text node collection failed, retrying on body:", err);
      try { collectTextNodes(document.body); } catch (e) { return null; }
    }

    // Helper to escape regex special characters
    const escapeRegExp = (str) => {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    // Clean leading/trailing spaces and make all whitespace sequences match any spacing
    const cleanQuery = (q) => {
      if (!q) return "";
      return q.trim().replace(/[\s\xa0\u200b\u200c]+/g, " ");
    };

    const cleanExact = cleanQuery(exact);
    if (!cleanExact) return null;

    const escapedExact = escapeRegExp(cleanExact).replace(/\\ /g, "[\\s\\xa0\\u200b\\u200c]+");
    let regex = new RegExp(escapedExact, "i");
    let index = -1;
    let matchedLength = exact.length;

    // 1. Context Search (Prefix + Exact + Suffix)
    const cleanPrefix = cleanQuery(prefix);
    const cleanSuffix = cleanQuery(suffix);

    if (cleanPrefix || cleanSuffix) {
      const escapedPrefix = cleanPrefix ? escapeRegExp(cleanPrefix).replace(/\\ /g, "[\\s\\xa0\\u200b\\u200c]+") : "";
      const escapedSuffix = cleanSuffix ? escapeRegExp(cleanSuffix).replace(/\\ /g, "[\\s\\xa0\\u200b\\u200c]+") : "";
      const contextPattern = (escapedPrefix ? `(${escapedPrefix})` : "") + `(${escapedExact})` + (escapedSuffix ? `(${escapedSuffix})` : "");
      
      try {
        const contextRegex = new RegExp(contextPattern, "i");
        const contextMatch = fullText.match(contextRegex);
        if (contextMatch) {
          const prefixMatchedText = cleanPrefix && contextMatch[1] ? contextMatch[1] : "";
          index = contextMatch.index + prefixMatchedText.length;
          const exactMatchedText = cleanPrefix ? contextMatch[2] : contextMatch[1];
          matchedLength = exactMatchedText ? exactMatchedText.length : exact.length;
        }
      } catch (e) {
        console.warn("Resilient context search failed, falling back to direct search", e);
      }
    }

    // 2. Direct Match fallback if context search failed
    if (index === -1) {
      const directMatch = fullText.match(regex);
      if (directMatch) {
        index = directMatch.index;
        matchedLength = directMatch[0].length;
      }
    }

    // 3. Resolve start/end text nodes and offsets based on computed index and match length
    if (index !== -1) {
      const range = document.createRange();
      let startNode = null;
      let startOffset = 0;
      let endNode = null;
      let endOffset = 0;

      for (let entry of textNodeRanges) {
        if (!startNode && entry.start <= index && index < entry.end) {
          startNode = entry.node;
          startOffset = index - entry.start;
        }
        if (entry.start <= index + matchedLength && index + matchedLength <= entry.end) {
          endNode = entry.node;
          endOffset = (index + matchedLength) - entry.start;
          break;
        }
      }

      if (startNode && endNode) {
        try {
          range.setStart(startNode, startOffset);
          range.setEnd(endNode, endOffset);
          return range;
        } catch (e) {
          console.warn("Failed to create Range from resolved nodes:", e);
        }
      }
    }

    return null;
  }

  // Anchor selection and save highlights to Thymer
  serializeSelection(range) {
    const exact = range.toString();

    // Get preceding prefix context
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(document.body);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const prefix = prefixRange.toString().slice(-32);

    // Get following suffix context
    const suffixRange = document.createRange();
    suffixRange.selectNodeContents(document.body);
    suffixRange.setStart(range.endContainer, range.endOffset);
    const suffix = suffixRange.toString().slice(0, 32);

    // Simple parent CSS selector path
    const parent = range.commonAncestorContainer.parentElement;
    const selector = this.getCssSelector(parent);

    return {
      exact,
      prefix,
      suffix,
      selector
    };
  }

  getCssSelector(el) {
    if (el.id) return `#${el.id}`;
    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.className) {
        selector += '.' + Array.from(el.classList).join('.');
      }
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  saveHighlightSelection(colorKey, note = "") {
    if (!this.activeRange) return;

    const anchor = this.serializeSelection(this.activeRange);
    const pageMeta = this.extractPageMetadata();
    const payload = {
      text: anchor.exact,
      url: this.getNormalizedUrl(window.location.href),
      title: document.title,
      selector: anchor,
      color: colorKey,
      author: pageMeta.author,
      note: note
    };

    chrome.runtime.sendMessage({
      type: "ADD_HIGHLIGHT",
      payload: payload,
      workspaceGuid: this.workspaceGuid
    }).then(res => {
      if (res && !res.error) {
        const { highlightGuid, bookmarkGuid } = res.payload;
        this.highlightRange(this.activeRange, colorKey, highlightGuid, bookmarkGuid);
        this.showToast("Highlight saved to Thymer ✓");
      } else {
        this.showToast(`Failed: ${res?.error || 'Unknown error'}`, true);
      }
    }).catch(err => {
      this.showToast(`Error: ${err.message}`, true);
    });

    this.hideSelectionMenu();
    window.getSelection().removeAllRanges();
  }

  // Wrap text range with mark element safely without disrupting parent tree flow
  highlightRange(range, colorKey, highlightGuid, bookmarkGuid, note = "") {
    const markTemplate = document.createElement("mark");
    markTemplate.className = "thymer-highlight";
    markTemplate.dataset.guid = highlightGuid;
    markTemplate.dataset.bookmark = bookmarkGuid;
    markTemplate.dataset.color = colorKey;
    markTemplate.dataset.note = note || "";
    
    const color = this.COLORS[colorKey] || this.COLORS.yellow;
    markTemplate.style.backgroundColor = `rgba(${color.rgb}, 0.35)`;
    markTemplate.style.color = "inherit";
    markTemplate.style.borderRadius = "3px";
    markTemplate.style.padding = "2px 0";

    const startContainer = range.startContainer;
    const startOffset = range.startOffset;
    const endContainer = range.endContainer;
    const endOffset = range.endOffset;

    // Case 1: The selection is within a single text node
    if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
      try {
        const textNode = startContainer;
        const selectedText = textNode.splitText(startOffset);
        selectedText.splitText(endOffset - startOffset);
        
        const mark = markTemplate.cloneNode(true);
        selectedText.parentNode.insertBefore(mark, selectedText);
        mark.appendChild(selectedText);
      } catch (err) {
        console.warn("Failed single text node wrap:", err);
      }
      return;
    }

    // Case 2: Range spans across multiple elements/text nodes
    // Gather all text nodes within the range boundary
    const textNodes = [];
    const collectTextNodes = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (range.intersectsNode(node)) {
          textNodes.push(node);
        }
      } else {
        for (let child of node.childNodes) {
          collectTextNodes(child);
        }
      }
    };

    try {
      collectTextNodes(range.commonAncestorContainer);
    } catch (collectErr) {
      console.warn("Failed to collect text nodes in range:", collectErr);
      return;
    }

    // Wrap each collected text node individually
    for (let i = 0; i < textNodes.length; i++) {
      try {
        const textNode = textNodes[i];
        let selectedTextNode = textNode;
        
        if (i === 0) {
          selectedTextNode = textNode.splitText(startOffset);
        }
        if (i === textNodes.length - 1) {
          const offset = (i === 0) ? (endOffset - startOffset) : endOffset;
          if (selectedTextNode.length > offset) {
            selectedTextNode.splitText(offset);
          }
        }

        const mark = markTemplate.cloneNode(true);
        selectedTextNode.parentNode.insertBefore(mark, selectedTextNode);
        mark.appendChild(selectedTextNode);
      } catch (nodeErr) {
        console.warn("Failed wrapping text node:", nodeErr);
      }
    }
  }

  async extractPageMetadataAsync() {
    // On LinkedIn, proactively expand "see more" buttons for full content
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes("linkedin.com")) {
      const seeMoreBtns = document.querySelectorAll(
        '.feed-shared-update-v2__description .see-more, .inline-show-more-text__button, [data-testid="feed-shared-inline-show-more"] button'
      );
      for (const btn of seeMoreBtns) {
        try { btn.click(); } catch (_) {}
      }
      await new Promise(r => setTimeout(r, 150));
    }
    return this.extractPageMetadata();
  }

  extractPageMetadata() {
    let title = document.title || "";
    // Clean up leading notification count like (3) or (99)
    title = title.replace(/^\(\d+\)\s+/, '');
    
    const url = this.getNormalizedUrl(window.location.href);
    const siteName = document.querySelector('meta[property="og:site_name"]')?.content || window.location.hostname;
    
    const excerpt = document.querySelector('meta[name="description"]')?.content ||
                    document.querySelector('meta[property="og:description"]')?.content ||
                    "";

    const selection = window.getSelection().toString();
    const bodyText = document.body.innerText || "";
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
    const htmlContent = this.getCleanHtml();

    // Extract images from the current page (social media-aware)
    const images = this.extractPageImages();

    // Parse Author details dynamically
    let authorName = "";
    let authorHandle = "";
    let authorProfileUrl = "";
    let authorPlatform = "web";

    // JSON-LD helper to extract author details
    const getJsonLdAuthor = () => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          
          const extract = (obj) => {
            if (!obj) return null;
            if (Array.isArray(obj)) {
              for (const item of obj) {
                const res = extract(item);
                if (res) return res;
              }
            }
            if (obj["@graph"] && Array.isArray(obj["@graph"])) {
              return extract(obj["@graph"]);
            }
            if (obj.author) {
              let name = "";
              let profileUrl = "";
              if (typeof obj.author === "string") name = obj.author;
              else if (Array.isArray(obj.author) && obj.author[0]) {
                name = typeof obj.author[0] === "string" ? obj.author[0] : (obj.author[0].name || "");
                profileUrl = obj.author[0].url || obj.author[0].sameAs || "";
              } else if (typeof obj.author === "object") {
                name = obj.author.name || "";
                profileUrl = obj.author.url || obj.author.sameAs || "";
              }
              if (name) return { name, profileUrl };
            }
            return null;
          };

          const author = extract(data);
          if (author) return author;
        } catch (e) {}
      }
      return null;
    };

    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
      authorPlatform = "twitter";
      
      // Try DOM selector first (highly accurate for post and profile pages)
      const userNameEl = document.querySelector('[data-testid="User-Name"]');
      if (userNameEl) {
        const links = userNameEl.querySelectorAll('a');
        if (links.length > 0) {
          const nameSpan = links[0].querySelector('span');
          authorName = nameSpan ? nameSpan.textContent?.trim() : links[0].textContent?.trim();
        }
        const handleEl = Array.from(links).find(link => {
          const href = link.getAttribute('href') || "";
          return href.startsWith('/') && !['/home', '/explore', '/notifications', '/messages', '/search', '/settings'].includes(href.toLowerCase());
        });
        if (handleEl) {
          const href = handleEl.getAttribute('href') || "";
          const handle = href.substring(1);
          authorHandle = "@" + handle;
          authorProfileUrl = `https://x.com/${handle}`;
        }
      }

      // Title fallbacks if DOM selector is not loaded/found
      if (!authorName) {
        const titleClean = title.replace(/\s*\/ X$/, '');
        if (titleClean.includes("on X:")) {
          authorName = titleClean.split("on X:")[0].trim();
        } else if (titleClean.includes("on Twitter:")) {
          authorName = titleClean.split("on Twitter:")[0].trim();
        } else {
          const titleMatch = titleClean.match(/^([^(\n]+)\s*\(?@?([^)\s]+)\)?/);
          if (titleMatch) {
            authorName = titleMatch[1].trim();
            if (!authorHandle) {
              authorHandle = "@" + titleMatch[2].trim();
              authorProfileUrl = `https://x.com/${titleMatch[2].trim()}`;
            }
          }
        }
      }

      // Fallback handle from URL path
      if (!authorHandle) {
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length > 1 && pathParts[1] && !["home", "explore", "notifications", "messages", "search"].includes(pathParts[1].toLowerCase())) {
          authorHandle = "@" + pathParts[1];
          authorProfileUrl = `https://x.com/${pathParts[1]}`;
        }
      }

      // Twitter post/tweet scraper
      const tweetTextEl = document.querySelector('article[data-testid="tweet"] [data-testid="tweetText"]');
      if (tweetTextEl && authorName) {
        let tweetText = tweetTextEl.textContent.trim();
        // Strip trailing short link if any
        tweetText = tweetText.replace(/https:\/\/t\.co\/\w+$/, '').trim();
        if (tweetText.length > 80) {
          tweetText = tweetText.substring(0, 80) + "...";
        }
        title = `${authorName} on X: "${tweetText}"`;
      } else {
        title = title.replace(/\s*\/ X$/, '').trim();
      }
    } else if (hostname.includes("linkedin.com")) {
      authorPlatform = "linkedin";
      
      // Try to find actor name in DOM
      const actorNameEl = document.querySelector(
        '.update-components-actor__name, .feed-shared-actor__title, .feed-shared-actor__name, .feed-shared-update-v2__actor .hoverable-link-text, [data-testid="actor-name"]'
      );
      if (actorNameEl) {
        authorName = actorNameEl.textContent.trim();
      }

      if (!authorName) {
        const titleClean = title.split("|")[0].trim();
        if (titleClean && titleClean !== "Post") {
          authorName = titleClean;
        }
      }

      // LinkedIn post scraper (extract first line)
      const postTextEl = document.querySelector('.feed-shared-update-v2__description-text, .update-components-text, .feed-shared-text');
      if (postTextEl && authorName) {
        const postText = postTextEl.textContent.trim();
        const firstLine = postText.split('\n').map(l => l.trim()).filter(Boolean)[0] || "";
        let cleanText = firstLine;
        if (cleanText.length > 70) {
          cleanText = cleanText.substring(0, 70) + "...";
        }
        title = `${authorName} ${cleanText}`.trim();
      } else {
        const titleClean = title.split("|")[0].trim();
        if (titleClean) {
          title = titleClean;
        }
      }
    } else if (hostname.includes("bsky.app")) {
      authorPlatform = "bluesky";
      const pathParts = window.location.pathname.split('/');
      if (pathParts.length > 2 && pathParts[1] === "profile") {
        authorHandle = "@" + pathParts[2];
        authorProfileUrl = `https://bsky.app/profile/${pathParts[2]}`;
      }
      const titleMatch = document.title.match(/^([^(\n]+)\s*\(([^)]+)\)/);
      if (titleMatch) {
        authorName = titleMatch[1].trim();
        if (!authorHandle) {
          authorHandle = "@" + titleMatch[2].trim();
          authorProfileUrl = `https://bsky.app/profile/${titleMatch[2].trim()}`;
        }
      }
    } else if (hostname.includes("instagram.com")) {
      authorPlatform = "instagram";
      const pathParts = window.location.pathname.split('/');
      if (pathParts.length > 1 && pathParts[1] && !["explore", "reels", "direct", "stories", "accounts"].includes(pathParts[1].toLowerCase())) {
        authorHandle = "@" + pathParts[1];
        authorProfileUrl = `https://instagram.com/${pathParts[1]}`;
      }
      const titleMatch = document.title.match(/^([^(\n]+)\s*\(([^)]+)\)/);
      if (titleMatch) {
        authorName = titleMatch[1].trim();
        if (!authorHandle) {
          authorHandle = "@" + titleMatch[2].trim();
          authorProfileUrl = `https://instagram.com/${titleMatch[2].trim()}`;
        }
      }
    } else if (hostname.includes("facebook.com")) {
      authorPlatform = "facebook";
      authorName = document.title.split("|")[0].trim();
      const pathParts = window.location.pathname.split('/');
      if (pathParts.length > 1 && pathParts[1] && !["pages", "groups", "events", "marketplace", "photo.php"].includes(pathParts[1].toLowerCase())) {
        authorHandle = pathParts[1];
        authorProfileUrl = `https://facebook.com/${pathParts[1]}`;
      }
    } else {
      // General articles (including Substack, Medium, blogs)
      if (hostname.includes("substack.com")) {
        authorPlatform = "substack";
      } else if (hostname.includes("medium.com")) {
        authorPlatform = "medium";
      }
      
      const jsonLd = getJsonLdAuthor();
      if (jsonLd) {
        authorName = jsonLd.name || "";
        if (jsonLd.profileUrl) {
          authorProfileUrl = jsonLd.profileUrl;
          if (jsonLd.profileUrl.includes("twitter.com") || jsonLd.profileUrl.includes("x.com")) {
            const parts = jsonLd.profileUrl.split('/');
            const handle = parts[parts.length - 1] || parts[parts.length - 2];
            if (handle) authorHandle = handle.startsWith("@") ? handle : "@" + handle;
          }
        }
      }

      // Substack / blog custom selectors when JSON-LD is missing or generic site author returned
      if (!authorName || authorName.toLowerCase() === "substack" || authorName.toLowerCase() === "medium") {
        const substackPeopleLink = document.querySelector('a[href*="/people/"], a[href*="/p/"], .byline-name a, .author-name a');
        if (substackPeopleLink && substackPeopleLink.textContent) {
          const text = substackPeopleLink.textContent.trim();
          if (text && text.toLowerCase() !== "substack" && !text.includes("subscribe")) {
            authorName = text;
            authorProfileUrl = substackPeopleLink.href;
          }
        }
      }

      // Standard Meta Tag fallback
      if (!authorName) {
        authorName = document.querySelector('meta[name="author"]')?.content ||
                     document.querySelector('meta[property="og:article:author"]')?.content ||
                     document.querySelector('.author-name, [rel="author"], .byline, .author, .creator')?.textContent?.trim() ||
                     "";
      }
      
      // Twitter handle extraction fallback
      if (!authorHandle) {
        const twitterCreator = document.querySelector('meta[name="twitter:creator"]')?.content ||
                               document.querySelector('meta[property="twitter:creator"]')?.content ||
                               "";
        if (twitterCreator && !["@substack", "@medium"].includes(twitterCreator.toLowerCase())) {
          authorHandle = twitterCreator.startsWith("@") ? twitterCreator : "@" + twitterCreator;
          if (!authorProfileUrl) authorProfileUrl = `https://x.com/${authorHandle.substring(1)}`;
        }
      }
    }

    return {
      title,
      url,
      siteName,
      excerpt,
      wordCount,
      htmlContent,
      images,
      author: {
        name: authorName.trim(),
        handle: authorHandle.trim(),
        profileUrl: authorProfileUrl.trim(),
        platform: authorPlatform
      },
      savedAt: new Date().toISOString()
    };
  }

  // ── Smart Twitter Thread Parser ──────────────────────────────────

  getTwitterThreadHtml() {
    const path = window.location.pathname;
    const match = path.match(/^\/([^\/]+)\/status\/(\d+)/);
    if (!match) return null;

    const threadAuthor = match[1].toLowerCase();
    const mainEl = document.querySelector('main');
    if (!mainEl) return null;

    const tweets = Array.from(mainEl.querySelectorAll('article[data-testid="tweet"]'));
    if (tweets.length === 0) return null;

    // Build author info from the first tweet
    let authorName = "";
    const firstUserEl = tweets[0].querySelector('[data-testid="User-Name"]');
    if (firstUserEl) {
      const links = firstUserEl.querySelectorAll('a');
      if (links.length > 0) {
        const nameSpan = links[0].querySelector('span');
        authorName = nameSpan ? nameSpan.textContent?.trim() : links[0].textContent?.trim();
      }
    }

    // Filter tweets to thread-author tweets only (chronological order preserved by DOM)
    const threadTweets = tweets.filter(tweet => {
      const userLinks = tweet.querySelectorAll('[data-testid="User-Name"] a');
      return Array.from(userLinks).some(link => {
        const href = link.getAttribute('href') || "";
        return href === `/${threadAuthor}` || href.startsWith(`/${threadAuthor}?`);
      });
    });

    if (threadTweets.length === 0) return null;

    // Build formatted HTML: each tweet in a blockquote, separated by <hr>
    let html = `<div class="twitter-thread">`;
    for (let i = 0; i < threadTweets.length; i++) {
      const tweetTextEl = threadTweets[i].querySelector('[data-testid="tweetText"]');
      const cleanedHtml = tweetTextEl ? this.cleanTweetTextHtml(tweetTextEl) : "";
      html += `<blockquote class="tweet">${cleanedHtml}</blockquote>`;
      if (i < threadTweets.length - 1) html += `<hr>`;
    }
    html += `</div>`;
    return html;
  }

  cleanTweetTextHtml(tweetTextEl) {
    const clone = tweetTextEl.cloneNode(true);

    // Replace custom emoji images with their alt attributes
    clone.querySelectorAll('img[alt]').forEach(img => {
      const alt = img.getAttribute('alt') || img.title || '';
      img.replaceWith(document.createTextNode(alt));
    });

    // Strip React data attributes, classes, inline styles — keep only essential attrs
    const allEls = clone.querySelectorAll('*');
    const keep = ['href', 'target', 'rel'];
    for (const el of allEls) {
      const attrs = el.attributes;
      for (let i = attrs.length - 1; i >= 0; i--) {
        if (!keep.includes(attrs[i].name)) {
          el.removeAttribute(attrs[i].name);
        }
      }
    }

    // Make relative links absolute
    clone.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('/')) {
        a.setAttribute('href', `https://x.com${href}`);
      }
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });

    return clone.innerHTML.trim();
  }

  // ── Smart LinkedIn Post Parser ────────────────────────────────────

  getLinkedInPostHtml() {
    const postContainer = document.querySelector('.feed-shared-update-v2') ||
      document.querySelector('[data-urn]') ||
      (document.querySelector('.update-components-actor__container')?.closest('.feed-shared-update-v2'));

    if (!postContainer) return null;

    // Extract author display name
    const authorNameEl = postContainer.querySelector(
      '.update-components-actor__name, .feed-shared-actor__title, .feed-shared-actor__name, .hoverable-link-text'
    );
    const authorName = authorNameEl ? authorNameEl.textContent.trim() : "";

    // Extract author professional headline
    const authorHeadlineEl = postContainer.querySelector(
      '.update-components-actor__description, .feed-shared-actor__description'
    );
    const authorHeadline = authorHeadlineEl ? authorHeadlineEl.textContent.trim() : "";

    // Extract and sanitize post text
    const textEl = postContainer.querySelector(
      '.feed-shared-update-v2__description-text, .update-components-text, .feed-shared-text'
    );

    let bodyHtml = "";
    if (textEl) {
      const clone = textEl.cloneNode(true);
      // Remove "see more" buttons that weren't expanded
      clone.querySelectorAll('.see-more, .inline-show-more-text__button, [data-testid="feed-shared-inline-show-more"]')
        .forEach(el => el.remove());
      bodyHtml = this.cleanLinkedInTextHtml(clone);
    }

    let html = `<div class="linkedin-post">`;
    if (authorName) {
      html += `<p class="linkedin-author"><strong>${this.escapeHtml(authorName)}</strong>`;
      if (authorHeadline) html += ` &mdash; ${this.escapeHtml(authorHeadline)}`;
      html += `</p>`;
    }
    if (bodyHtml) {
      html += `<div class="linkedin-text">${bodyHtml}</div>`;
    }
    html += `</div>`;

    return html;
  }

  cleanLinkedInTextHtml(container) {
    // Strip React data attributes, classes, inline styles — keep only essential attrs
    const allEls = container.querySelectorAll('*');
    const keep = ['href', 'target', 'rel', 'src', 'alt'];
    for (const el of allEls) {
      const attrs = el.attributes;
      for (let i = attrs.length - 1; i >= 0; i--) {
        if (!keep.includes(attrs[i].name)) {
          el.removeAttribute(attrs[i].name);
        }
      }
    }

    // Make relative links absolute on LinkedIn
    container.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('/')) {
        a.setAttribute('href', `https://linkedin.com${href}`);
      }
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });

    return container.innerHTML.trim();
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Extract meaningful images from the page.
  // For Twitter/X: grabs media from all tweets in the thread (within main).
  // For LinkedIn: grabs images from the post container, excluding avatars.
  // For general pages: falls back to og:image or large inline images.
  extractPageImages() {
    const images = [];
    const seen = new Set();
    const hostname = window.location.hostname.toLowerCase();

    const addImg = (src, alt) => {
      if (!src) return;
      // Skip tiny icons, SVGs, tracking pixels and data URIs
      if (src.startsWith('data:') || src.endsWith('.svg')) return;
      const clean = src.split('?')[0];
      if (seen.has(clean)) return;
      seen.add(clean);
      images.push({ src, alt: alt || "" });
    };

    if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
      // Collect media from all tweets in the thread (within main column)
      const mainEl = document.querySelector('main');
      const tweetArticles = mainEl
        ? mainEl.querySelectorAll('article[data-testid="tweet"]')
        : document.querySelectorAll('article[data-testid="tweet"]');

      for (const tweet of tweetArticles) {
        tweet.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="tweet_image"] img').forEach(img => {
          addImg(img.src, img.alt);
        });
        tweet.querySelectorAll('video[poster]').forEach(v => {
          addImg(v.poster, 'video thumbnail');
        });
        tweet.querySelectorAll('[data-testid="card.layoutSmall.media"] img, [data-testid="card.layoutLarge.media"] img').forEach(img => {
          addImg(img.src, img.alt);
        });
      }
    } else if (hostname.includes("linkedin.com")) {
      // LinkedIn post media — scope to the post container and exclude avatars
      const postContainer = document.querySelector('.feed-shared-update-v2');
      if (postContainer) {
        postContainer.querySelectorAll('img').forEach(img => {
          if (img.closest('.update-components-actor__avatar, .feed-shared-actor__avatar, .ivm-image-view-model, [class*="avatar"]')) return;
          if (img.naturalWidth && img.naturalWidth < 150) return;
          addImg(img.src, img.alt);
        });
      }
    } else {
      // General pages: prefer og:image, then article images > 200px
      const ogImage = document.querySelector('meta[property="og:image"]')?.content;
      if (ogImage) addImg(ogImage, document.querySelector('meta[property="og:image:alt"]')?.content || '');

      const articleEl = document.querySelector('article') || document.querySelector('main');
      if (articleEl) {
        articleEl.querySelectorAll('img').forEach(img => {
          if (img.naturalWidth && img.naturalWidth < 200) return;
          addImg(img.src, img.alt);
        });
      }
    }

    return images;
  }

  getCleanHtml() {
    const hostname = window.location.hostname.toLowerCase();

    // Smart Twitter thread parser
    if (hostname.includes("x.com") || hostname.includes("twitter.com")) {
      const threadHtml = this.getTwitterThreadHtml();
      if (threadHtml) return threadHtml;
    }

    // Smart LinkedIn post parser
    if (hostname.includes("linkedin.com")) {
      const postHtml = this.getLinkedInPostHtml();
      if (postHtml) return postHtml;
    }

    // Generic fallback
    const article = document.querySelector('article');
    if (article) return article.innerHTML;

    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, iframe, thymer-clipper-container, header, footer, nav').forEach(el => el.remove());
    return clone.innerHTML;
  }

  showToast(text, isError = false) {
    const toast = document.createElement('div');
    toast.className = `thymer-toast ${isError ? 'error' : 'success'}`;
    toast.textContent = text;
    this.shadowRoot.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 50);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

// Instantiate once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ThymerClipper());
} else {
  new ThymerClipper();
}
