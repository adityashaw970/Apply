// ══════════════════════════════════════════════════════════
// MassApply — Browser UI Logic (v2)
// Chrome-like tab management + Left/Right panels
// Keyboard shortcuts + History Manager
// ══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // ─── State ───
  let tabs = [];         // { id, title, url }
  let activeTabId = null;
  let profile = {};
  let settings = {};
  let shortcuts = []; // { name, url, icon }
  let injectorScript = '';
  let totalFilled = 0, totalAI = 0, totalSkipped = 0;
  let browsingHistory = []; // { url, title, timestamp, favicon }

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  // ─── DOM ───
  const tabsScroll = $('#tabs-scroll');
  const webviewContainer = $('#webview-container');
  const shortcutsPage = $('#shortcuts-page');
  const addressInput = $('#address-input');
  const btnApply = $('#btn-apply');
  const statusText = $('#status-text');
  const logsScroll = $('#logs-scroll');

  // Panels
  const leftPanel = $('#left-panel');
  const rightPanel = $('#right-panel');

  // Modal DOM
  const modalOverlay = $('#modal-add-shortcut');
  const btnAddShortcut = $('#btn-add-shortcut');
  const btnCancelSc = $('#btn-cancel-sc');
  const btnSaveSc = $('#btn-save-sc');
  const inputScName = $('#sc-name');
  const inputScUrl = $('#sc-url');

  // ═══ WINDOW CONTROLS ═══
  $('#btn-minimize').onclick = () => window.api.window.minimize();
  $('#btn-maximize').onclick = () => window.api.window.maximize();
  $('#btn-close').onclick = () => window.api.window.close();

  // ═══ KEYBOARD SHORTCUTS ═══
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+T — New Tab
    if (ctrl && e.key === 't') {
      e.preventDefault();
      createTab('', 'New Tab');
      addressInput.focus();
      addressInput.select();
    }
    // Ctrl+W — Close Current Tab
    if (ctrl && e.key === 'w') {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    }
    // Ctrl+R or F5 — Reload
    if ((ctrl && e.key === 'r') || e.key === 'F5') {
      e.preventDefault();
      if (activeTabId) {
        const wv = webviewContainer.querySelector(`#${activeTabId}`);
        if (wv) wv.reload();
      }
    }
    // Ctrl+L — Focus Address Bar
    if (ctrl && e.key === 'l') {
      e.preventDefault();
      addressInput.focus();
      addressInput.select();
    }
    // Ctrl+Shift+T — Reopen last closed (placeholder)
    // Alt+Left — Back
    if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (activeTabId) {
        const wv = webviewContainer.querySelector(`#${activeTabId}`);
        if (wv && wv.canGoBack()) wv.goBack();
      }
    }
    // Alt+Right — Forward
    if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      if (activeTabId) {
        const wv = webviewContainer.querySelector(`#${activeTabId}`);
        if (wv && wv.canGoForward()) wv.goForward();
      }
    }
    // Ctrl+1-9 — Switch to tab
    if (ctrl && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (idx < tabs.length) switchTab(tabs[idx].id);
    }
    // Ctrl+Tab — Next tab
    if (ctrl && e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx >= 0 && tabs.length > 1) {
        switchTab(tabs[(idx + 1) % tabs.length].id);
      }
    }
    // Ctrl+Shift+Tab — Previous tab
    if (ctrl && e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx >= 0 && tabs.length > 1) {
        switchTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
      }
    }
    // Ctrl+H — Toggle History panel
    if (ctrl && e.key === 'h') {
      e.preventDefault();
      rightPanel.classList.toggle('open');
    }
    // Ctrl+Shift+S — Screenshot to clipboard
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      takeScreenshotToClipboard();
    }
    // Ctrl+= / Ctrl++ — Zoom In
    if (ctrl && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      if (activeTabId) {
        const wv = webviewContainer.querySelector(`#${activeTabId}`);
        if (wv) wv.setZoomLevel(wv.getZoomLevel() + 1);
      }
    }
    // Ctrl+- — Zoom Out
    if (ctrl && e.key === '-') {
      e.preventDefault();
      if (activeTabId) {
        const wv = webviewContainer.querySelector(`#${activeTabId}`);
        if (wv) wv.setZoomLevel(wv.getZoomLevel() - 1);
      }
    }
    // Ctrl+0 — Reset Zoom
    if (ctrl && e.key === '0') {
      e.preventDefault();
      if (activeTabId) {
        const wv = webviewContainer.querySelector(`#${activeTabId}`);
        if (wv) wv.setZoomLevel(0);
      }
    }
    // Escape — Close modals
    if (e.key === 'Escape') {
      modalOverlay.classList.remove('active');
    }
  });

  // ═══ TAB MANAGEMENT ═══
  let tabCounter = 0;

  function createTab(url, title) {
    const id = 'tab-' + (++tabCounter);
    url = url || '';
    title = title || 'New Tab';

    tabs.push({ id, title, url });

    // Create tab button
    const tabEl = document.createElement('div');
    tabEl.className = 'browser-tab';
    tabEl.dataset.id = id;
    tabEl.innerHTML = `
      <span class="tab-title">${escapeHtml(title)}</span>
      <button class="tab-close" data-id="${id}"><span class="material-icons-round">close</span></button>
    `;
    tabEl.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close')) switchTab(id);
    });
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(id);
    });

    // ── Drag-to-reorder ──
    tabEl.draggable = true;
    tabEl.addEventListener('dragstart', (e) => {
      tabEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });
    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('dragging');
      tabsScroll.querySelectorAll('.browser-tab').forEach(t => t.classList.remove('drag-over'));
    });
    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!tabEl.classList.contains('dragging')) tabEl.classList.add('drag-over');
    });
    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('drag-over');
    });
    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      tabEl.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId === id) return;

      const fromIdx = tabs.findIndex(t => t.id === draggedId);
      const toIdx = tabs.findIndex(t => t.id === id);
      if (fromIdx === -1 || toIdx === -1) return;

      // Reorder tabs array
      const [moved] = tabs.splice(fromIdx, 1);
      tabs.splice(toIdx, 0, moved);

      // Reorder DOM
      const draggedEl = tabsScroll.querySelector(`[data-id="${draggedId}"]`);
      if (draggedEl) {
        if (fromIdx < toIdx) {
          tabEl.after(draggedEl);
        } else {
          tabEl.before(draggedEl);
        }
      }
      saveTabs();
    });

    tabsScroll.appendChild(tabEl);
    // Create webview
    const wv = document.createElement('webview');
    wv.id = id;
    wv.setAttribute('src', url || 'about:blank');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'nativeWindowOpen=no');
    wv.setAttribute('partition', 'persist:massapply');
    // Use Chrome/134 UA to match the session-level UA set in main.js (CLEAN_UA)
    // All tabs share the same partition so Google sign-in cookies apply everywhere.
    wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
    wv.style.width = '100%';
    wv.style.height = '100%';

    // *** CRITICAL: Attach new-window handler BEFORE appending to DOM ***
    wv.addEventListener('new-window', (e) => {
      const newUrl = e.url || '';
      if (!newUrl || newUrl === 'about:blank') return;

      // Let OAuth / Sign-In URLs open as real popup windows (handled by main.js setWindowOpenHandler).
      // Google's GSI "Continue with" button MUST open in a real popup — webview tab breaks the auth flow.
      const isAuthUrl = newUrl.includes('accounts.google.com') ||
        newUrl.includes('/oauth') ||
        newUrl.includes('/signin') ||
        newUrl.includes('appleid.apple.com') ||
        newUrl.includes('login.microsoftonline.com');

      if (isAuthUrl) {
        console.log('🔐 new-window → OAuth URL, letting main.js handle as popup:', newUrl);
        // Do NOT preventDefault — this lets setWindowOpenHandler in main.js open it as a real popup
        return;
      }

      // All other new-window requests: open as in-app tab
      e.preventDefault();
      console.log('🔗 new-window → opening inside app tab:', newUrl);
      const newTabId = createTab(newUrl, 'Loading...');
      switchTab(newTabId);
    });

    // Append to container AFTER attaching event listeners
    webviewContainer.appendChild(wv);

    // Standard webview events

    wv.addEventListener('did-stop-loading', () => {
      updateTabLoading(id, false);
    });

    wv.addEventListener('page-title-updated', (e) => {
      updateTabTitle(id, e.title);
    });

    wv.addEventListener('did-navigate', (e) => {
      const tab = tabs.find(t => t.id === id);
      if (tab) tab.url = e.url;
      if (activeTabId === id) addressInput.value = e.url;
      addToHistory(e.url, tab?.title || '');
    });

    wv.addEventListener('did-navigate-in-page', (e) => {
      if (e.isMainFrame) {
        const tab = tabs.find(t => t.id === id);
        if (tab) tab.url = e.url;
        if (activeTabId === id) addressInput.value = e.url;
      }
    });

    // Run stealth scripts as early as possible
    wv.addEventListener('did-start-loading', () => {
      updateTabLoading(id, true);
      wv.executeJavaScript(`
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      window.chrome = window.chrome || { runtime: {} };
    } catch(e) {}
  `);
    });

    // Inject window.open interceptor + context menu after DOM is ready
    wv.addEventListener('dom-ready', () => {
      wv.executeJavaScript(`
    (function() {
      // Intercept window.open calls
      const originalOpen = window.open;
      window.open = function(url, name, features) {
        console.log('window.open called:', url);
        return originalOpen.call(this, url, name, features);
      };
      
      // Intercept link clicks with target="_blank" (but NOT auth/sign-in links)
      document.addEventListener('click', function(e) {
        const link = e.target.closest('a[target="_blank"]');
        if (link && link.href) {
          // Let auth/OAuth links through without intercepting
          const h = link.href.toLowerCase();
          if (h.includes('accounts.google.com') || h.includes('/oauth') ||
              h.includes('/signin') || h.includes('/auth/') ||
              h.includes('login.microsoftonline.com') || h.includes('appleid.apple.com')) {
            console.log('Auth link — not intercepting:', link.href);
            return; // Let the browser handle it naturally
          }
          e.preventDefault();
          e.stopPropagation();
          console.log('Intercepted _blank link:', link.href);
          window.open(link.href, '_blank');
        }
      }, true);

      // Fast double-click detection (200 ms window) on link clicks.
      // The native 'dblclick' event only fires AFTER the OS-level double-click
      // timeout (~300-500 ms), causing a visible delay. By tracking clicks
      // manually we fire on the 2nd click itself — instant response.
      let _lastClickTime = 0;
      let _lastClickEl   = null;
      document.addEventListener('click', function(e) {
        const link = e.target.closest('a');
        if (!link || !link.href) return;
        if (link.href.startsWith('javascript:') || link.href === '#') return;

        const now = Date.now();
        if (now - _lastClickTime < 200 && _lastClickEl === link) {
          // Second click within 200 ms → treat as double-click
          e.preventDefault();
          e.stopPropagation();
          console.log('Fast double-click navigate:', link.href);
          window.location.href = link.href;
          _lastClickTime = 0;   // reset so a 3rd click doesn't re-trigger
          _lastClickEl   = null;
        } else {
          _lastClickTime = now;
          _lastClickEl   = link;
        }
      }, true);


      // Right-click context menu data capture
      document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        const link = e.target.closest('a');
        const img = e.target.closest('img');
        const sel = window.getSelection()?.toString() || '';
        const data = {
          x: e.clientX,
          y: e.clientY,
          linkUrl: link ? link.href : null,
          linkText: link ? (link.textContent || '').trim().substring(0, 100) : null,
          imgSrc: img ? img.src : null,
          selectedText: sel.substring(0, 500),
          pageUrl: window.location.href
        };
        console.log('__CTX_MENU__' + JSON.stringify(data));
      });
    })();
  `).catch(err => console.log('Could not inject interceptor:', err));
    });

    // Suppress certificate error spam + handle context menu messages
    wv.addEventListener('console-message', (e) => {
      if (e.message.includes('CertVerifyProcBuiltin') ||
        e.message.includes('pfSense') ||
        e.message.includes('pfBNG-DNSBL') ||
        e.message.includes('ERROR: No matching issuer')) {
        return;
      }
      // Handle context menu data from injected script
      if (e.message.startsWith('__CTX_MENU__')) {
        try {
          const data = JSON.parse(e.message.replace('__CTX_MENU__', ''));
          showContextMenu(data, wv, id);
        } catch (err) {
          console.log('Context menu parse error:', err);
        }
      }
    });

    // Handle downloads
    wv.addEventListener('will-download', (e, item) => {
      console.log('📥 Download started:', item.getFilename?.() || 'file');
      toast('📥 Downloading file', 'info');
    });

    switchTab(id);
    if (url) saveTabs();
    return id;
  }

  function switchTab(id) {
    activeTabId = id;
    const tab = tabs.find(t => t.id === id);

    // Update tab bar
    $$('.browser-tab').forEach(t => t.classList.toggle('active', t.dataset.id === id));

    // Update webviews
    webviewContainer.querySelectorAll('webview').forEach(wv => {
      wv.classList.toggle('active', wv.id === id);
    });

    // Show/hide shortcuts
    const isNewTab = !tab || !tab.url || tab.url === 'about:blank' || tab.url === '';
    shortcutsPage.classList.toggle('active', isNewTab);

    // Update address bar
    if (tab) {
      addressInput.value = tab.url || '';
    }
  }

  function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    tabs.splice(idx, 1);

    // Remove tab button
    const tabBtn = tabsScroll.querySelector(`[data-id="${id}"]`);
    if (tabBtn) tabBtn.remove();

    // Remove webview
    const wv = webviewContainer.querySelector(`#${id}`);
    if (wv) wv.remove();

    // Switch to another tab or show shortcuts
    if (tabs.length > 0) {
      const newActive = tabs[Math.min(idx, tabs.length - 1)];
      switchTab(newActive.id);
    } else {
      activeTabId = null;
      addressInput.value = '';
      shortcutsPage.classList.add('active'); // Show shortcuts if no tabs
    }
    saveTabs();
  }

  function updateTabTitle(id, title) {
    const tab = tabs.find(t => t.id === id);
    if (tab) tab.title = title;
    const tabEl = tabsScroll.querySelector(`[data-id="${id}"] .tab-title`);
    if (tabEl) tabEl.textContent = title;
  }

  function updateTabLoading(id, loading) {
    if (activeTabId === id) {
      statusText.textContent = loading ? 'Loading...' : 'Ready';
    }
  }

  // New tab button
  $('#btn-new-tab').addEventListener('click', () => {
    createTab('', 'New Tab');
    addressInput.focus();
    addressInput.select();
  });

  // ═══ IPC: Open URL in new tab (triggered by main.js setWindowOpenHandler) ═══
  // When a webview fires a new-window event (e.g. clicking an arrow/external link),
  // main.js intercepts it via setWindowOpenHandler, which in modern Electron
  // silently swallows the event if you return { action: 'deny' }.
  // Instead main.js sends this IPC message so we can open it as an in-app tab.
  if (window.api && window.api.on && window.api.on.openInNewTab) {
    window.api.on.openInNewTab((url) => {
      if (url && url !== 'about:blank') {
        console.log('📂 IPC open-in-new-tab:', url);
        const newTabId = createTab(url, 'Loading...');
        switchTab(newTabId);
      }
    });
  }

  // ═══ NAVIGATION ═══
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      let url = addressInput.value.trim();
      if (!url) return;

      // Auto-add https
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.includes('.') && !url.includes(' ')) {
          url = 'https://' + url;
        } else {
          url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
        }
      }

      if (activeTabId) {
        const wv = webviewContainer.querySelector(`#${activeTabId}`);
        if (wv) {
          // loadURL() is imperative and fires immediately.
          // wv.src = url is declarative — Electron processes it asynchronously
          // through the attribute-change cycle, causing the visible lag.
          wv.loadURL(url);
          const tab = tabs.find(t => t.id === activeTabId);
          if (tab) tab.url = url;
          saveTabs();
        }
      } else {
        createTab(url, 'Loading...');
      }

      addressInput.value = url;
    }
  });

  $('#btn-back').addEventListener('click', () => {
    if (!activeTabId) return;
    const wv = webviewContainer.querySelector(`#${activeTabId}`);
    if (wv && wv.canGoBack()) wv.goBack();
  });

  $('#btn-forward').addEventListener('click', () => {
    if (!activeTabId) return;
    const wv = webviewContainer.querySelector(`#${activeTabId}`);
    if (wv && wv.canGoForward()) wv.goForward();
  });

  $('#btn-reload').addEventListener('click', () => {
    if (!activeTabId) return;
    const wv = webviewContainer.querySelector(`#${activeTabId}`);
    if (wv) wv.reload();
  });

  // ═══ LEFT PANEL (Profile/Settings/Logs) ═══
  $('#btn-left-panel-toggle').addEventListener('click', () => {
    leftPanel.classList.toggle('open');
  });

  // Panel tabs (left)
  $$('.left-panel .panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.left-panel .panel-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.left-panel .panel-content').forEach(c => c.classList.remove('active'));
      $(`#panel-${btn.dataset.panel}`).classList.add('active');
    });
  });

  // ═══ RIGHT PANEL (History) ═══
  $('#btn-right-panel-toggle').addEventListener('click', () => {
    rightPanel.classList.toggle('open');
  });

  // ═══ BROWSING HISTORY ═══
  function addToHistory(url, title) {
    if (!url || url === 'about:blank' || url === '') return;
    // De-duplicate: don't add if last entry is same URL
    if (browsingHistory.length > 0 && browsingHistory[0].url === url) return;

    browsingHistory.unshift({
      url,
      title: title || url,
      timestamp: Date.now(),
      favicon: getFaviconUrl(url)
    });

    // Cap at 500 entries
    if (browsingHistory.length > 500) browsingHistory.length = 500;

    renderHistory();
  }

  function renderHistory(filter = '') {
    const scroll = $('#history-scroll');
    scroll.innerHTML = '';

    const filtered = filter
      ? browsingHistory.filter(h =>
        h.title.toLowerCase().includes(filter.toLowerCase()) ||
        h.url.toLowerCase().includes(filter.toLowerCase()))
      : browsingHistory;

    if (filtered.length === 0) {
      scroll.innerHTML = '<div class="history-empty">No browsing history yet</div>';
      return;
    }

    // Group by date
    const groups = {};
    filtered.forEach(h => {
      const date = new Date(h.timestamp);
      const key = isToday(date) ? 'Today'
        : isYesterday(date) ? 'Yesterday'
          : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (!groups[key]) groups[key] = [];
      groups[key].push(h);
    });

    for (const [date, items] of Object.entries(groups)) {
      const dateEl = document.createElement('div');
      dateEl.className = 'history-date-group';
      dateEl.textContent = date;
      scroll.appendChild(dateEl);

      items.forEach((h, idx) => {
        const el = document.createElement('div');
        el.className = 'history-item';
        const time = new Date(h.timestamp);
        const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        el.innerHTML = `
          <div class="history-item-icon">
            ${h.favicon ? `<img src="${h.favicon}" onerror="this.outerHTML='<span class=\\'material-icons-round\\'>public</span>'">` : '<span class="material-icons-round">public</span>'}
          </div>
          <div class="history-item-info">
            <div class="history-item-title">${escapeHtml(h.title)}</div>
            <div class="history-item-url">${escapeHtml(h.url)}</div>
          </div>
          <span class="history-item-time">${timeStr}</span>
          <button class="history-item-delete" title="Remove"><span class="material-icons-round">close</span></button>
        `;

        // Click to navigate
        el.addEventListener('click', (e) => {
          if (e.target.closest('.history-item-delete')) return;
          navigateTo(h.url, h.title);
        });

        // Delete single entry
        el.querySelector('.history-item-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          const realIdx = browsingHistory.findIndex(bh => bh.url === h.url && bh.timestamp === h.timestamp);
          if (realIdx >= 0) browsingHistory.splice(realIdx, 1);
          renderHistory(filter);
        });

        scroll.appendChild(el);
      });
    }
  }

  function isToday(date) {
    const now = new Date();
    return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }
  function isYesterday(date) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    return date.getDate() === y.getDate() && date.getMonth() === y.getMonth() && date.getFullYear() === y.getFullYear();
  }

  // History search
  $('#history-search').addEventListener('input', (e) => {
    renderHistory(e.target.value);
  });

  // Clear all history
  $('#btn-clear-history').addEventListener('click', () => {
    browsingHistory = [];
    renderHistory();
    toast('History cleared', 'success');
  });

  // ═══ PROFILE ═══
  async function loadProfile() {
    profile = await window.api.profile.get();
    $$('#panel-profile [data-field]').forEach(f => {
      if (profile[f.dataset.field] !== undefined && profile[f.dataset.field] !== null) {
        f.value = profile[f.dataset.field];
      }
    });
    // Render saved custom Q&A
    renderQA(profile.customQA || []);
    // Render saved work experiences
    renderWorkExperiences(profile.workExperiences || []);
  }

  function collectProfile() {
    const data = {};
    $$('#panel-profile [data-field]').forEach(f => {
      data[f.dataset.field] = f.value;
    });
    // Collect custom Q&A pairs
    const qaRows = $$('#qa-list .qa-row');
    data.customQA = [];
    qaRows.forEach(row => {
      const q = row.querySelector('.qa-question')?.value?.trim();
      const a = row.querySelector('.qa-answer')?.value?.trim();
      if (q) data.customQA.push({ question: q, answer: a || '' });
    });
    // Collect work experiences
    const weCards = $$('#work-exp-list .work-exp-card');
    data.workExperiences = [];
    weCards.forEach(card => {
      const we = {};
      card.querySelectorAll('[data-we]').forEach(f => {
        if (f.type === 'checkbox') {
          we[f.dataset.we] = f.checked ? 'true' : 'false';
        } else {
          we[f.dataset.we] = f.value;
        }
      });
      if (we.company || we.designationLeaving || we.designationJoining) data.workExperiences.push(we);
    });
    return data;
  }


  // ═══ CUSTOM Q&A MANAGEMENT ═══
  function renderQA(qaList) {
    const container = $('#qa-list');
    if (!container) return;
    container.innerHTML = '';
    (qaList || []).forEach((item) => addQARow(item.question, item.answer));
  }

  function addQARow(question = '', answer = '') {
    const container = $('#qa-list');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'qa-row';
    row.innerHTML = `
      <input type="text" class="qa-question" placeholder="Question (e.g., Years of Python exp)" value="${escapeHtml(question)}" style="min-width: 0;">
      <input type="text" class="qa-answer" placeholder="Answer (e.g., 3)" value="${escapeHtml(answer)}" style="min-width: 0;">
      <div class="qa-row-actions">
        <button class="qa-icon-btn del-btn" title="Delete row"><span class="material-icons-round">delete_outline</span></button>
      </div>
    `;
    row.querySelector('.del-btn').addEventListener('click', () => {
      row.style.opacity = '0'; row.style.transform = 'translateX(10px)';
      row.style.transition = 'all 0.2s';
      setTimeout(() => row.remove(), 200);
    });
    container.appendChild(row);
  }

  $('#btn-add-qa').addEventListener('click', () => addQARow());

  // ═══ WORK EXPERIENCE MULTI-ENTRY ═══
  function renderWorkExperiences(list) {
    const container = $('#work-exp-list');
    if (!container) return;
    container.innerHTML = '';
    (list || []).forEach(we => addWorkExpCard(we));
  }

  function addWorkExpCard(data = {}) {
    const container = $('#work-exp-list');
    if (!container) return;
    const card = document.createElement('div');
    card.className = 'work-exp-card';
    const idx = container.querySelectorAll('.work-exp-card').length + 1;
    const currentlyChecked = data.currentlyWorking === 'true' || data.currentlyWorking === true ? 'checked' : '';

    const empTypes = ['Full Time', 'Part Time', 'Internship', 'Contract', 'Freelance', 'Apprenticeship'];
    const empTypeOptions = empTypes.map(t =>
      `<option value="${t}"${data.empType === t ? ' selected' : ''}>${t}</option>`
    ).join('');

    card.innerHTML = `
      <div class="work-exp-card-header">
        <span class="work-exp-card-title">Experience #${idx}</span>
        <div class="work-exp-card-actions">
          <button class="work-exp-btn del-btn" title="Remove this experience"><span class="material-icons-round">delete_outline</span></button>
        </div>
      </div>
      <div class="work-exp-grid">
        <label class="full">Company Name<input type="text" data-we="company" placeholder="Infosys / TCS" value="${escapeHtml(data.company || '')}"></label>
        <label>Designation on Joining<input type="text" data-we="designationJoining" placeholder="Junior Developer" value="${escapeHtml(data.designationJoining || '')}"></label>
        <label>Designation on Leaving<input type="text" data-we="designationLeaving" placeholder="Senior Developer" value="${escapeHtml(data.designationLeaving || data.designation || '')}"></label>
        <label>Country<input type="text" data-we="workCountry" placeholder="India" value="${escapeHtml(data.workCountry || '')}"></label>
        <label>State<input type="text" data-we="workState" placeholder="Maharashtra" value="${escapeHtml(data.workState || '')}"></label>
        <label>City<input type="text" data-we="workCity" placeholder="Mumbai" value="${escapeHtml(data.workCity || '')}"></label>
        <label>Sector / Industry<input type="text" data-we="sector" placeholder="IT / Software" value="${escapeHtml(data.sector || '')}"></label>
        <label>Work Experience Type<select data-we="empType">
          <option value="">Select...</option>${empTypeOptions}
        </select></label>
        <label>Start Date<input type="text" data-we="startDate" placeholder="Jan 2023 / 2023-01" value="${escapeHtml(data.startDate || '')}"></label>
        <label>End Date
          <span style="display:flex;gap:6px;align-items:center;">
            <input type="text" data-we="endDate" placeholder="Dec 2024" value="${escapeHtml(data.endDate || '')}" style="flex:1;">
            <label style="display:flex;align-items:center;gap:3px;font-size:9px;white-space:nowrap;text-transform:none;letter-spacing:0;">
              <input type="checkbox" data-we="currentlyWorking" ${currentlyChecked} style="width:12px;height:12px;accent-color:var(--accent);"> Currently&nbsp;Working
            </label>
          </span>
        </label>
        <label>Annual Compensation<input type="text" data-we="compensation" placeholder="6 LPA / 500000" value="${escapeHtml(data.compensation || '')}"></label>
        <label>Number of Months<input type="number" data-we="numMonths" placeholder="12" min="0" value="${escapeHtml(data.numMonths || '')}"></label>
        <label class="full">Key Responsibilities<textarea data-we="description" rows="2" placeholder="Key responsibilities, achievements, technologies used...">${escapeHtml(data.description || '')}</textarea></label>
      </div>
    `;

    // Toggle end-date field when 'currently working' is checked
    const cbCurrent = card.querySelector('[data-we="currentlyWorking"]');
    const endDateInput = card.querySelector('[data-we="endDate"]');
    cbCurrent.addEventListener('change', () => {
      endDateInput.disabled = cbCurrent.checked;
      endDateInput.placeholder = cbCurrent.checked ? 'Present' : 'Dec 2024';
      if (cbCurrent.checked) endDateInput.value = '';
    });
    if (cbCurrent.checked) {
      endDateInput.disabled = true;
      endDateInput.placeholder = 'Present';
    }

    card.querySelector('.del-btn').addEventListener('click', () => {
      card.style.opacity = '0';
      card.style.transition = 'all 0.2s';
      setTimeout(() => { card.remove(); renumberWorkExpCards(); }, 200);
    });
    container.appendChild(card);
  }

  function renumberWorkExpCards() {
    $$('#work-exp-list .work-exp-card-title').forEach((t, i) => {
      t.textContent = `Experience #${i + 1}`;
    });
  }

  if ($('#btn-add-work-exp')) {
    $('#btn-add-work-exp').addEventListener('click', () => addWorkExpCard());
  }

  $('#btn-save-profile').addEventListener('click', async () => {
    profile = collectProfile();
    await window.api.profile.save(profile);
    toast('Profile saved!', 'success');
  });

  // ═══ SCREENSHOT TO CLIPBOARD ═══
  async function takeScreenshotToClipboard() {
    const btn = $('#btn-screenshot');
    if (btn) { btn.classList.add('screenshot-flash'); setTimeout(() => btn.classList.remove('screenshot-flash'), 400); }
    try {
      statusText.textContent = 'Taking screenshot...';
      // Use Electron's capturePage to capture the entire window
      const dataUrl = await window.api.window.screenshot();
      if (!dataUrl) {
        toast('Screenshot failed — API unavailable', 'error');
        statusText.textContent = 'Ready';
        return;
      }
      // Convert data URL to blob and copy to clipboard
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      toast('📸 Screenshot copied to clipboard!', 'success');
      statusText.textContent = 'Screenshot copied!';
      setTimeout(() => statusText.textContent = 'Ready', 2000);
    } catch (err) {
      console.error('Screenshot error:', err);
      toast('Screenshot failed: ' + err.message, 'error');
      statusText.textContent = 'Ready';
    }
  }

  if ($('#btn-screenshot')) {
    $('#btn-screenshot').addEventListener('click', () => takeScreenshotToClipboard());
  }

  // ═══ COPY URL BUTTON ═══
  const btnCopyUrl = $('#btn-copy-url');
  if (btnCopyUrl) {
    btnCopyUrl.addEventListener('click', () => {
      const url = addressInput.value.trim();
      if (!url) { toast('No URL to copy', 'warning'); return; }
      navigator.clipboard.writeText(url).then(() => {
        toast('🔗 URL copied!', 'success');
        const icon = btnCopyUrl.querySelector('.material-icons-round');
        if (icon) { icon.textContent = 'check'; setTimeout(() => { icon.textContent = 'content_copy'; }, 1500); }
      }).catch(() => toast('Copy failed', 'error'));
    });
  }

  // ═══ SETTINGS ═══
  async function loadSettings() {
    settings = await window.api.settings.get();
    $('#set-geminiApiKey').value = settings.geminiApiKey || '';
    $('#set-autoSubmit').value = String(settings.autoSubmit !== false);
    if ($('#set-resumePath')) $('#set-resumePath').value = settings.resumePath || '';
    if ($('#set-jobPreference')) $('#set-jobPreference').value = settings.jobPreference || 'all';
  }

  // Open Gemini API key page in new tab
  const linkGeminiKey = document.getElementById('link-gemini-key');
  if (linkGeminiKey) {
    linkGeminiKey.addEventListener('click', (e) => {
      e.preventDefault();
      createTab('https://aistudio.google.com/app/apikey', 'Get Gemini API Key');
      toast('Opening Google AI Studio...', 'info');
    });
  }

  // ═══ CACHE & SITE DATA ═══
  const btnShowCache = $('#btn-show-cache');
  const btnClearCache = $('#btn-clear-cache');
  const siteDataList = $('#site-data-list');

  if (btnShowCache && btnClearCache && siteDataList) {
    btnShowCache.addEventListener('click', async () => {
      siteDataList.style.display = 'block';
      siteDataList.innerHTML = '<div style="color:#aaa;font-size:12px;text-align:center;">Loading...</div>';
      try {
        const domains = await window.api.appData.getSiteData();
        if (!domains || domains.length === 0) {
          siteDataList.innerHTML = '<div style="color:#aaa;font-size:12px;text-align:center;">No site data found.</div>';
          return;
        }
        siteDataList.innerHTML = '';
        domains.forEach(domain => {
          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.justifyContent = 'space-between';
          row.style.alignItems = 'center';
          row.style.padding = '6px 4px';
          row.style.borderBottom = '1px solid #333';

          row.innerHTML = `
            <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
              <span class="material-icons-round" style="font-size:16px;color:#888;">public</span>
              <span style="font-size:12px;color:#ddd;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;">${escapeHtml(domain)}</span>
            </div>
            <button class="cache-del-btn" title="Delete" style="background:transparent;border:none;color:#ff5252;cursor:pointer;padding:2px;display:flex;align-items:center;">
              <span class="material-icons-round" style="font-size:18px;">delete</span>
            </button>
          `;

          row.querySelector('.cache-del-btn').addEventListener('click', async () => {
            row.style.opacity = '0.5';
            row.style.pointerEvents = 'none';
            await window.api.appData.clearSiteData(domain);
            row.remove();
            if (siteDataList.children.length === 0) {
              siteDataList.innerHTML = '<div style="color:#aaa;font-size:12px;text-align:center;">No site data found.</div>';
            }
          });

          siteDataList.appendChild(row);
        });
      } catch (e) {
        siteDataList.innerHTML = `<div style="color:#ff5252;font-size:12px;">Error: ${e.message}</div>`;
      }
    });

    btnClearCache.addEventListener('click', async () => {
      if (confirm("Are you sure you want to clear all cookies, cache, and site data? This will also reload the browser to reset your session.")) {
        btnShowCache.disabled = true;
        btnClearCache.disabled = true;
        btnClearCache.innerHTML = '<span class="material-icons-round">hourglass_empty</span> Resetting...';

        await window.api.appData.clearAllSiteData();

        siteDataList.style.display = 'block';
        siteDataList.innerHTML = '<div style="color:#aaa;font-size:12px;text-align:center;">Session reset and all site data cleared.</div>';

        // Reload the webview to start fresh
        try {
          if (wv && typeof wv.reload === 'function') {
            wv.reload();
          }
        } catch (err) {
          console.log('Error reloading webview:', err);
        }

        toast('Session Reset & Storage Cleared', 'success');
        btnShowCache.disabled = false;
        btnClearCache.disabled = false;
        btnClearCache.innerHTML = '<span class="material-icons-round">restart_alt</span> Reset & Clear Cache';
      }
    });
  }

  $('#btn-save-settings').addEventListener('click', async () => {
    settings = {
      ...settings,
      geminiApiKey: $('#set-geminiApiKey').value.trim(),
      autoSubmit: $('#set-autoSubmit').value === 'true',
      resumePath: ($('#set-resumePath')?.value || '').trim(),
      jobPreference: $('#set-jobPreference')?.value || 'all'
    };
    await window.api.settings.save(settings);
    toast('Settings saved!', 'success');
  });

  // ═══ SHORTCUTS LOGIC ═══
  let dragSrcIndex = null;

  async function loadShortcuts() {
    try {
      shortcuts = await window.api.shortcuts.get();
    } catch (e) {
      shortcuts = [];
    }
    if (!shortcuts || shortcuts.length === 0) {
      shortcuts = [
        { name: 'ChatGPT', url: 'https://chat.openai.com' },
        { name: 'Claude', url: 'https://claude.ai' },
        { name: 'Gemini', url: 'https://gemini.google.com' },
        { name: 'LinkedIn', url: 'https://www.linkedin.com' },
        { name: 'Gmail', url: 'https://mail.google.com' }
      ];
      try { await window.api.shortcuts.save(shortcuts); } catch (e) { }
    } else {
      // Migrate old broken URLs
      const urlFixes = {
        'https://linkedin.com': 'https://www.linkedin.com',
        'https://gmail.com': 'https://mail.google.com'
      };
      let changed = false;
      shortcuts.forEach(sc => {
        if (urlFixes[sc.url]) { sc.url = urlFixes[sc.url]; changed = true; }
      });
      if (changed) {
        try { await window.api.shortcuts.save(shortcuts); } catch (e) { }
      }
    }
    renderShortcuts();
  }

  function getFaviconUrl(url) {
    try {
      const u = new URL(url);
      let domain = u.hostname;
      // Map subdomains to main domain for better favicon resolution
      const domainMap = {
        'mail.google.com': 'gmail.com',
        'chat.openai.com': 'openai.com',
        'www.linkedin.com': 'linkedin.com'
      };
      domain = domainMap[domain] || domain;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    } catch (e) {
      return '';
    }
  }

  function renderShortcuts() {
    const grid = $('#shortcuts-grid');
    // Remove everything from grid
    grid.innerHTML = '';

    shortcuts.forEach((sc, index) => {
      const el = document.createElement('div');
      el.className = 'shortcut-item';
      el.title = sc.url;
      el.draggable = true;
      el.dataset.index = index;

      const iconUrl = getFaviconUrl(sc.url);

      el.innerHTML = `
        <div class="sc-icon">
          ${iconUrl
          ? `<img src="${iconUrl}" class="sc-img" onerror="this.remove();this.parentElement.innerHTML='<span class=\\'material-icons-round\\'>public</span>'">`
          : `<span class="material-icons-round">public</span>`
        }
        </div>
        <span class="sc-title">${escapeHtml(sc.name)}</span>
        <div class="sc-delete"><span class="material-icons-round">close</span></div>
      `;

      // --- Click to navigate ---
      el.addEventListener('click', (e) => {
        if (e.target.closest('.sc-delete')) return;
        navigateTo(sc.url, sc.name);
      });

      // --- Delete ---
      el.querySelector('.sc-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        shortcuts.splice(index, 1);
        try { await window.api.shortcuts.save(shortcuts); } catch (e) { }
        renderShortcuts();
      });

      // --- Drag & Drop ---
      el.addEventListener('dragstart', (e) => {
        dragSrcIndex = index;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        grid.querySelectorAll('.shortcut-item').forEach(i => i.classList.remove('drag-over'));
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('drag-over');
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });
      el.addEventListener('drop', async (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const targetIndex = parseInt(el.dataset.index);
        if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
          // Swap in array
          const moved = shortcuts.splice(dragSrcIndex, 1)[0];
          shortcuts.splice(targetIndex, 0, moved);
          try { await window.api.shortcuts.save(shortcuts); } catch (e) { }
          renderShortcuts();
        }
        dragSrcIndex = null;
      });

      grid.appendChild(el);
    });

    // Add button — always last
    const addBtn = document.createElement('div');
    addBtn.className = 'shortcut-item add-btn';
    addBtn.innerHTML = `
      <div class="sc-icon"><span class="material-icons-round">add</span></div>
      <span class="sc-title">Add shortcut</span>
    `;
    addBtn.addEventListener('click', openAddModal);
    grid.appendChild(addBtn);
  }

  function navigateTo(url, title) {
    if (activeTabId) {
      const tab = tabs.find(t => t.id === activeTabId);
      // If current tab is a blank/new tab, navigate in-place
      const isBlank = !tab.url || tab.url === 'about:blank' || tab.url === '' || tab.url === 'about:newtab';
      if (isBlank) {
        const wv = webviewContainer.querySelector(`#${activeTabId}`);
        if (wv) {
          // Use loadURL (imperative) instead of wv.src (declarative/async) for instant navigation
          if (typeof wv.loadURL === 'function') {
            wv.loadURL(url);
          } else {
            wv.src = url;
          }
        }
        tab.url = url;
        tab.title = title || url;
        addressInput.value = url;
        shortcutsPage.classList.remove('active');
        saveTabs();
      } else {
        createTab(url, title);
      }
    } else {
      createTab(url, title);
    }
  }

  // ═══ CUSTOM RIGHT-CLICK CONTEXT MENU ═══
  let ctxMenu = null;
  let ctxOverlay = null;

  function hideContextMenu() {
    if (ctxMenu) ctxMenu.classList.remove('visible');
    if (ctxOverlay) ctxOverlay.classList.remove('visible');
  }

  // Create the overlay and menu elements once
  function ensureContextMenuElements() {
    if (!ctxOverlay) {
      ctxOverlay = document.createElement('div');
      ctxOverlay.className = 'ctx-overlay';
      document.body.appendChild(ctxOverlay);
      // Any click on the overlay (including over the webview) dismisses the menu
      ctxOverlay.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideContextMenu();
      });
    }
    if (!ctxMenu) {
      ctxMenu = document.createElement('div');
      ctxMenu.className = 'ctx-menu';
      ctxMenu.id = 'ctx-menu';
      document.body.appendChild(ctxMenu);
    }
  }

  // Dismiss on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideContextMenu();
  });

  function showContextMenu(data, wv, tabId) {
    ensureContextMenuElements();

    const hasLink = !!data.linkUrl;
    const hasImage = !!data.imgSrc;
    const hasSelection = !!data.selectedText;

    let html = '';

    // ── Link section ──
    if (hasLink) {
      html += `<div class="ctx-item" data-action="openLinkNewTab">
        <span class="material-icons-round">open_in_new</span> Open link in new tab
      </div>`;
      html += `<div class="ctx-sep"></div>`;
      html += `<div class="ctx-item" data-action="copyLink">
        <span class="material-icons-round">link</span> Copy link address
      </div>`;
      html += `<div class="ctx-sep"></div>`;
    }

    // ── Image section ──
    if (hasImage) {
      html += `<div class="ctx-item" data-action="openImageNewTab">
        <span class="material-icons-round">image</span> Open image in new tab
      </div>`;
      html += `<div class="ctx-item" data-action="copyImageAddress">
        <span class="material-icons-round">content_copy</span> Copy image address
      </div>`;
      html += `<div class="ctx-sep"></div>`;
    }

    // ── Copy / Select All ──
    if (hasSelection) {
      html += `<div class="ctx-item" data-action="copy">
        <span class="material-icons-round">content_copy</span> Copy
      </div>`;
    }
    html += `<div class="ctx-item" data-action="selectAll">
      <span class="material-icons-round">select_all</span> Select all
    </div>`;
    html += `<div class="ctx-sep"></div>`;

    // ── Navigation ──
    html += `<div class="ctx-item" data-action="back">
      <span class="material-icons-round">arrow_back</span> Back
    </div>`;
    html += `<div class="ctx-item" data-action="forward">
      <span class="material-icons-round">arrow_forward</span> Forward
    </div>`;
    html += `<div class="ctx-item" data-action="reload">
      <span class="material-icons-round">refresh</span> Reload
    </div>`;
    html += `<div class="ctx-sep"></div>`;

    // ── DevTools ──
    html += `<div class="ctx-item" data-action="inspect">
      <span class="material-icons-round">code</span> Inspect
    </div>`;

    ctxMenu.innerHTML = html;

    // Position the menu relative to the webview
    const wvRect = wv.getBoundingClientRect();
    let menuX = wvRect.left + data.x;
    let menuY = wvRect.top + data.y;

    // Show overlay + menu to measure
    ctxOverlay.classList.add('visible');
    ctxMenu.style.left = '0px';
    ctxMenu.style.top = '0px';
    ctxMenu.classList.add('visible');

    // Adjust to keep within viewport
    const menuRect = ctxMenu.getBoundingClientRect();
    if (menuX + menuRect.width > window.innerWidth) {
      menuX = window.innerWidth - menuRect.width - 8;
    }
    if (menuY + menuRect.height > window.innerHeight) {
      menuY = window.innerHeight - menuRect.height - 8;
    }
    if (menuX < 0) menuX = 8;
    if (menuY < 0) menuY = 8;

    ctxMenu.style.left = menuX + 'px';
    ctxMenu.style.top = menuY + 'px';

    // Handle menu clicks
    ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = item.dataset.action;

        switch (action) {
          case 'openLinkNewTab':
            if (data.linkUrl) {
              const newId = createTab(data.linkUrl, data.linkText || 'Loading...');
              switchTab(newId);
              toast('Opened in new tab', 'info');
            }
            break;

          case 'copyLink':
            if (data.linkUrl) {
              navigator.clipboard.writeText(data.linkUrl).then(() => {
                toast('Link copied!', 'success');
              });
            }
            break;

          case 'openImageNewTab':
            if (data.imgSrc) {
              const newId = createTab(data.imgSrc, 'Image');
              switchTab(newId);
            }
            break;

          case 'copyImageAddress':
            if (data.imgSrc) {
              navigator.clipboard.writeText(data.imgSrc).then(() => {
                toast('Image address copied!', 'success');
              });
            }
            break;

          case 'copy':
            if (data.selectedText) {
              navigator.clipboard.writeText(data.selectedText).then(() => {
                toast('Copied!', 'success');
              });
            }
            break;

          case 'selectAll':
            try {
              wv.executeJavaScript('document.execCommand("selectAll")');
            } catch (err) { }
            break;

          case 'back':
            if (wv && wv.canGoBack()) wv.goBack();
            break;

          case 'forward':
            if (wv && wv.canGoForward()) wv.goForward();
            break;

          case 'reload':
            if (wv) wv.reload();
            break;

          case 'inspect':
            try {
              const wcId = wv.getWebContentsId();
              await window.api.webview.inspectElement(wcId, Math.round(data.x), Math.round(data.y));
            } catch (err) {
              console.log('Inspect element error:', err);
              toast('Could not open DevTools', 'error');
            }
            break;
        }

        hideContextMenu();
      });
    });
  }

  // Add Shortcut Modal
  function openAddModal() {
    inputScName.value = '';
    inputScUrl.value = '';
    modalOverlay.classList.add('active');
    // Use setTimeout to ensure focus works
    setTimeout(() => inputScName.focus(), 100);
  }

  // Prevent clicks inside modal from propagating to shortcuts page
  modalOverlay.addEventListener('mousedown', (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove('active');
    }
  });

  // Stop propagation on modal inputs to prevent focus issues
  modalOverlay.querySelector('.modal').addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  btnCancelSc.addEventListener('click', () => {
    modalOverlay.classList.remove('active');
  });

  btnSaveSc.addEventListener('click', async () => {
    const name = inputScName.value.trim();
    let url = inputScUrl.value.trim();

    if (!name || !url) {
      toast('Name and URL required', 'error');
      return;
    }

    if (!url.startsWith('http')) url = 'https://' + url;

    shortcuts.push({ name, url });
    try { await window.api.shortcuts.save(shortcuts); } catch (e) { }
    renderShortcuts();
    modalOverlay.classList.remove('active');
    toast('Shortcut added!', 'success');
  });

  // Allow pressing Enter in the URL field to save
  inputScUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSaveSc.click();
  });
  inputScName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inputScUrl.focus();
  });

  // ═══ APPLY BUTTON — THE CORE FEATURE ═══
  btnApply.addEventListener('click', async () => {
    if (!activeTabId) {
      toast('Open a job page first!', 'warning');
      return;
    }

    // Save latest profile
    profile = collectProfile();
    await window.api.profile.save(profile);

    const wv = webviewContainer.querySelector(`#${activeTabId}`);
    if (!wv) return;

    btnApply.classList.add('working');
    btnApply.querySelector('.apply-label').textContent = 'Filling...';
    statusText.textContent = 'Scanning form fields...';
    log('accent', '⚡ Apply clicked — scanning page...');

    try {
      // Step 1: Get field map and injector script
      const fieldMap = await window.api.profile.getFieldMap();

      if (!injectorScript) {
        injectorScript = await window.api.engine.getInjectorScript();
      }

      // Step 2: Build options from settings
      const options = {
        overwrite: true, // Always overwrite existing values
        autoSubmit: settings.autoSubmit === true
      };

      // Step 3: Inject the form-filler into the webview
      const script = injectorScript
        .replace('FIELD_MAP_PLACEHOLDER', JSON.stringify(fieldMap))
        .replace('USER_PROFILE_PLACEHOLDER', JSON.stringify(profile))
        .replace('OPTIONS_PLACEHOLDER', JSON.stringify(options));

      const resultJson = await wv.executeJavaScript(script);
      const result = JSON.parse(resultJson);

      log('info', `📄 Page: ${result.pageTitle}`);
      log('info', `📋 Found ${result.totalFields} fields — Filled ${result.filledCount} from profile`);

      totalFilled += result.filledCount;
      updateStats();

      if (result.errors.length > 0) {
        result.errors.forEach(err => log('error', '❌ ' + err));
      }

      // Step 4: Handle unknown fields with AI — batch ALL questions at once
      if (result.unknownFields.length > 0) {
        log('accent', `🤖 Sending ${result.unknownFields.length} unknown questions to AI (batch)...`);
        statusText.textContent = 'AI answering all questions at once...';

        // *** Send FULL profile details to AI for most accurate responses ***
        const aiAnswers = await window.api.ai.answerQuestions({
          questions: result.unknownFields,
          jobContext: {
            title: result.pageTitle || '',
            company: result.company || '',
            description: result.jobDescription || ''
          },
          userProfile: profile  // Full profile data sent to AI
        });

        // Check for server connection error
        const serverError = aiAnswers.find(a => a.error && a.error.includes('Server not running'));
        if (serverError) {
          log('error', '❌ ' + serverError.error);
          toast('Start the AI server: npx nodemon server.js', 'error');
        }

        // Step 5: Build ONE script that fills ALL AI answers at once
        const validAnswers = [];
        for (const answer of aiAnswers) {
          if (!answer.answer || answer.answer.trim() === '' || answer.answer === 'N/A') {
            totalSkipped++;
            log('warn', `⏭️ Skipped: "${answer.label}"`);
            continue;
          }
          const field = result.unknownFields.find(f => f.label === answer.label);
          if (field) {
            validAnswers.push({ field, answer: answer.answer });
          }
        }

        // Inject ALL answers in a single script execution
        if (validAnswers.length > 0) {
          try {
            const batchFillScript = buildBatchFillScript(validAnswers);
            await wv.executeJavaScript(batchFillScript);
            totalAI += validAnswers.length;
            validAnswers.forEach(va => {
              log('success', `✅ AI filled: "${va.field.label}" → "${va.answer.substring(0, 50)}"`);
            });
          } catch (err) {
            log('error', `❌ Batch fill failed: ${err.message}`);
            totalSkipped += validAnswers.length;
          }
        }

        log('info', `🤖 AI filled ${validAnswers.length} of ${result.unknownFields.length} questions`);
      }

      if (result.skippedFields.length > 0) {
        totalSkipped += result.skippedFields.length;
        result.skippedFields.forEach(f => log('info', `⏭️ "${f.label}" — ${f.reason}`));
      }

      // Step 5.5: Handle file upload (resume) — Multi-strategy approach
      if (result.hasFileUpload && result.fileUploadSelectors.length > 0) {
        const resumePath = profile.resumePath || settings.resumePath || '';
        if (resumePath) {
          log('accent', `📎 Uploading resume: ${resumePath}`);
          statusText.textContent = 'Uploading resume...';

          const isGoogleForm = result.pageUrl.includes('docs.google.com/forms');
          const webContentsId = wv.getWebContentsId();

          for (const fileField of result.fileUploadSelectors) {
            try {
              let uploadResult = null;
              let uploadMethod = '';
              let pathToUpload = resumePath;

              if (fileField.label && fileField.label.toLowerCase().includes('cover letter')) {
                const coverLetterPath = profile.coverLetterPath || '';
                if (coverLetterPath) {
                  pathToUpload = coverLetterPath;
                  log('accent', `📎 Uploading cover letter: ${pathToUpload}`);
                }
              }

              // Strategy 1: Smart DataTransfer injection (works on most standard forms)
              if (!isGoogleForm) {
                log('info', `📎 Trying smart upload (DataTransfer) for "${fileField.label}"...`);
                uploadResult = await window.api.engine.smartUploadFile({
                  webContentsId,
                  selector: fileField.selector,
                  filePath: pathToUpload
                });
                uploadMethod = 'DataTransfer';
              }

              // Strategy 2: CDP DOM.setFileInputFiles (fallback for standard forms)
              if (!uploadResult?.success && !isGoogleForm) {
                log('info', `📎 Trying CDP upload for "${fileField.label}"...`);
                uploadResult = await window.api.engine.uploadFile({
                  webContentsId,
                  selector: fileField.selector,
                  filePath: pathToUpload
                });
                uploadMethod = 'CDP';
              }

              // Strategy 3: Google Forms file chooser interception
              if (!uploadResult?.success && isGoogleForm) {
                log('info', `📎 Trying Google Forms upload for "${fileField.label}"...`);
                uploadResult = await window.api.engine.googleFormsUpload({
                  webContentsId,
                  filePath: pathToUpload
                });
                uploadMethod = 'GoogleForms';
              }

              if (uploadResult?.success) {
                log('success', `✅ File uploaded to "${fileField.label}" via ${uploadMethod}`);
              } else {
                log('warn', `⚠️ File upload failed: ${uploadResult?.error || 'unknown error'}`);
              }
            } catch (err) {
              log('error', `❌ File upload error: ${err.message}`);
            }
          }

          // Wait for file upload to settle
          await new Promise(r => setTimeout(r, 2000));
        } else {
          log('warn', '⚠️ File upload field detected but no resume path configured');
          toast('Set resume path in Settings for auto-upload', 'warning');
        }
      }

      // Step 6: Auto-submit AFTER all fields (profile + AI + file) are filled
      if (settings.autoSubmit === true && result.filledCount + totalAI > 0) {
        log('accent', '📤 Auto-submitting form...');
        statusText.textContent = 'Submitting form...';
        // Wait for all fields to settle
        await new Promise(r => setTimeout(r, 2000));

        const currentUrl = await wv.executeJavaScript('window.location.href');

        try {
          // Primary: Use CDP native click for truly trusted events
          const webContentsId = wv.getWebContentsId();
          const isGF = currentUrl.includes('docs.google.com/forms');
          const isWF = currentUrl.includes('wellfound.com') || currentUrl.includes('angel.co');

          // Determine the best submit selector for this page type
          let nativeClickSelector;
          if (isGF) {
            nativeClickSelector = '[jsname="M2UYVd"]';
          } else if (isWF) {
            // Wellfound modal submit button — exact data-test attribute
            nativeClickSelector = '[data-test="JobApplicationModal--SubmitButton"]';
          } else {
            nativeClickSelector = 'button[type="submit"]';
          }

          const nativeResult = await window.api.engine.nativeClick({
            webContentsId,
            selector: nativeClickSelector
          });

          if (nativeResult.success) {
            log('success', '✅ Form submitted! (native click)');
          } else {
            // Fallback: JavaScript click
            log('info', '↩️ Trying JS click fallback...');
            const jsResult = await wv.executeJavaScript(buildAutoSubmitScript());
            if (jsResult === 'submitted') {
              log('success', '✅ Form submitted! (JS click)');
            } else {
              log('warn', '⚠️ Submit: ' + jsResult);
            }
          }

          // Check if page navigated after submit (indicating success)
          await new Promise(r => setTimeout(r, 3000));
          const newUrl = await wv.executeJavaScript('window.location.href');
          if (newUrl !== currentUrl) {
            log('success', '🎉 Page navigated — submission confirmed!');
          }
        } catch (e) {
          log('warn', '⚠️ Auto-submit may have failed: ' + e.message);
        }
      }

      updateStats();
      statusText.textContent = `Done! Filled ${result.filledCount + totalAI} fields`;
      log('success', `🎉 Form filling complete!`);
      btnApply.classList.remove('working');
      btnApply.classList.add('done');
      btnApply.querySelector('.apply-label').textContent = 'Done!';

      // Save to history
      await window.api.history.add({
        url: result.pageUrl,
        title: result.pageTitle,
        filled: result.filledCount,
        aiFilled: totalAI,
        skipped: totalSkipped
      });

      // Reset button after 3s
      setTimeout(() => {
        btnApply.classList.remove('done');
        btnApply.querySelector('.apply-label').textContent = 'Apply';
      }, 3000);

    } catch (err) {
      log('error', '❌ Error: ' + err.message);
      statusText.textContent = 'Error — check logs';
      toast('Apply failed: ' + err.message, 'error');
      btnApply.classList.remove('working');
      btnApply.querySelector('.apply-label').textContent = 'Apply';
    }
  });

  // Build a script to fill a single unknown field by selector (kept as fallback)
  function buildFillScript(field, value) {
    if (!field) return '""';
    const escaped = JSON.stringify(value);
    const isGF = `window.location.hostname.includes('docs.google.com')`;

    // For Google Forms fields without selectors, find by label text
    if (!field.selector || field.selector === '') {
      return `
        (function() {
          const containers = document.querySelectorAll('.Qr7Oae, .freebirdFormviewerViewItemsItemItem, .geS5n');
          for (const c of containers) {
            const title = c.querySelector('.M7eMe, .HoXoMd, .freebirdFormviewerComponentsQuestionBaseTitle');
            if (!title || !title.textContent.trim().includes(${JSON.stringify(field.label.substring(0, 50))})) continue;

            // Text input
            const inp = c.querySelector('input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input:not([type]), textarea');
            if (inp) { inp.focus(); inp.value = ${escaped}; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; }

            // Radio
            const radios = c.querySelectorAll('[role="radio"]');
            if (radios.length > 0) {
              const target = ${escaped}.toLowerCase();
              for (const r of radios) {
                const lbl = (r.querySelector('.YEVVod, .ulDsOb, span')?.textContent || r.textContent || '').toLowerCase().trim();
                if (lbl.includes(target) || target.includes(lbl)) { r.click(); return 'ok'; }
              }
              radios[0]?.click();
              return 'ok';
            }

            // Checkbox
            const checks = c.querySelectorAll('[role="checkbox"]');
            if (checks.length > 0) {
              const target = ${escaped}.toLowerCase();
              for (const ch of checks) {
                const lbl = (ch.querySelector('.YEVVod, .ulDsOb, span')?.textContent || ch.textContent || '').toLowerCase().trim();
                if (lbl.includes(target) || target.includes(lbl)) { ch.click(); return 'ok'; }
              }
              return 'ok';
            }
          }
          return 'not found';
        })();
      `;
    }

    // Standard selector-based fill
    return `
      (function() {
        const el = document.querySelector('${field.selector.replace(/'/g, "\\'")}');
        if (!el) return 'not found';
        const type = '${field.type}' || el.type || el.tagName.toLowerCase();
        if (type === 'select' || type === 'select-one') {
          const opts = Array.from(el.options);
          const target = ${escaped}.toLowerCase();
          const match = opts.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()))
                     || opts.find(o => o.value.toLowerCase().includes(target));
          if (match) { el.value = match.value; el.dispatchEvent(new Event('change', {bubbles:true})); }
        } else if (type === 'checkbox') {
          const should = ['yes','true','1','agree'].includes(${escaped}.toLowerCase());
          if (should !== el.checked) el.click();
        } else if (type === 'radio') {
          const radios = document.querySelectorAll('input[type="radio"][name="' + el.name + '"]');
          for (const r of radios) {
            const lbl = (r.closest('label')?.textContent || r.value).toLowerCase();
            if (lbl.includes(${escaped}.toLowerCase())) { r.click(); break; }
          }
        } else {
          el.focus();
          try {
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, ${escaped});
            else el.value = ${escaped};
          } catch(e) { el.value = ${escaped}; }
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
        }
        return 'ok';
      })();
    `;
  }

  // Build a single script that fills ALL AI answers at once
  function buildBatchFillScript(validAnswers) {
    const answersData = validAnswers.map(va => ({
      label: va.field.label.substring(0, 150),
      answer: va.answer,
      type: va.field.type,
      selector: va.field.selector || '',
      name: va.field.name || '',
      isWellfound: va.field.isWellfound || false
    }));

    return `
      (function() {
        const answers = ${JSON.stringify(answersData)};
        const isGF = window.location.hostname.includes('docs.google.com');
        const isTuring = (window.location.hostname.includes('turing.com') &&
                          document.querySelector('.job-interest-form') !== null);
        const isWellfound = (window.location.hostname.includes('wellfound.com') ||
                             window.location.hostname.includes('angel.co')) &&
                            !!(
                              document.querySelector('[data-test="JobApplication-Modal"]') ||
                              document.querySelector('[data-test="JobApplicationModal--SubmitButton"]') ||
                              document.querySelector('[class*="styles_modal__"]')
                            );
        let filled = 0;

        function safeSet(el, value) {
          el.focus();
          try {
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, value);
            else el.value = value;
          } catch(e) { el.value = value; }
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
          el.dispatchEvent(new Event('blur', {bubbles:true}));
        }

        // Wellfound: remove disabled & fill an element using React's native setter
        function wellfoundFill(el, value) {
          if (!el) return;
          el.removeAttribute('disabled');
          el.removeAttribute('readonly');
          safeSet(el, value);
          // Also trigger a simulated keyboard event so React's onChange fires
          el.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true, key:'a'}));
          el.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true, key:'a'}));
        }

        for (const ans of answers) {
          try {
            if (isWellfound || ans.isWellfound) {
              // ── Wellfound modal: find the textarea by name or selector ──
              const modal = document.querySelector('[data-test="JobApplication-Modal"]');
              let fieldEl = null;

              // Try by name attribute first (most reliable for Wellfound)
              // Use querySelectorAll + filter to avoid CSS escaping issues with brackets in names
              if (ans.name) {
                const candidates = Array.from((modal || document).querySelectorAll('textarea[name], input[name]'));
                fieldEl = candidates.find(el => el.getAttribute('name') === ans.name) || null;
              }

              // Try by selector
              if (!fieldEl && ans.selector) {
                try { fieldEl = (modal || document).querySelector(ans.selector); } catch(e) {}
              }

              // Search by label text — walk the modal's labels
              if (!fieldEl && modal) {
                const labels = modal.querySelectorAll('label');
                for (const lbl of labels) {
                  const clone = lbl.cloneNode(true);
                  clone.querySelectorAll('input, textarea').forEach(el => el.remove());
                  const lblText = clone.textContent.trim();
                  if (lblText.toLowerCase().includes(ans.label.substring(0, 30).toLowerCase()) ||
                      ans.label.toLowerCase().includes(lblText.substring(0, 30).toLowerCase())) {
                    fieldEl = lbl.querySelector('textarea') || lbl.querySelector('input:not([type="hidden"])');
                    if (fieldEl) break;
                  }
                }
              }

              // Last-resort: specifically try userNote (Cover Letter), then any customQuestionAnswers
              if (!fieldEl && modal) {
                // userNote = Cover Letter field
                if (ans.name === 'userNote' || ans.label.toLowerCase().includes('cover letter') ||
                    ans.label.toLowerCase().includes('write a note') || ans.label.toLowerCase().includes('note to')) {
                  fieldEl = modal.querySelector('textarea[name="userNote"], textarea[id*="userNote"]');
                }
              }
              if (!fieldEl && modal) {
                const cfTextareas = modal.querySelectorAll('textarea[name*="customQuestionAnswers"], input[name*="customQuestionAnswers"]');
                if (cfTextareas.length > 0) fieldEl = cfTextareas[0];
              }
              // Absolute last resort: first unfilled textarea in modal
              if (!fieldEl && modal) {
                const anyTextarea = modal.querySelector('textarea:not([name*="submitted"]):not([disabled])');
                if (anyTextarea) fieldEl = anyTextarea;
              }

              if (fieldEl) {
                wellfoundFill(fieldEl, ans.answer);
                filled++;
                console.log('Wellfound: filled field', ans.label, '->', ans.answer.substring(0, 50));
              } else {
                console.log('Wellfound: could not find field for:', ans.label);
              }

            } else if (isTuring) {

              // ── Turing form: find the row by matching question heading text ──
              const rows = document.querySelectorAll('.job-interest-form__row');
              let found = false;
              for (const row of rows) {
                const headingEl = row.querySelector('.job-interest-form__question__heading');
                if (!headingEl) continue;
                let heading = headingEl.textContent.trim().replace(/^\\d+\\.\\s*/, '').trim();
                
                // Match by label (first 40 chars is enough for uniqueness)
                const ansLabel = ans.label.substring(0, 40).toLowerCase();
                const headingLower = heading.substring(0, 40).toLowerCase();
                if (!headingLower.includes(ansLabel.substring(0, 30)) && 
                    !ansLabel.includes(headingLower.substring(0, 30))) continue;
                
                // Found the matching row — now fill based on type
                
                // Radio buttons (ant-radio-input)
                const radios = row.querySelectorAll('.ant-radio-input');
                if (radios.length > 0) {
                  const target = ans.answer.toLowerCase().trim();
                  let clicked = false;
                  for (const r of radios) {
                    const wrapper = r.closest('.ant-radio-wrapper');
                    const lbl = wrapper ? wrapper.textContent.trim().toLowerCase() : r.value.toLowerCase();
                    if (lbl.includes(target) || target.includes(lbl) ||
                        (target.includes('yes') && lbl.includes('yes')) ||
                        (target.includes('no') && lbl.includes('no'))) {
                      r.click();
                      if (wrapper) wrapper.click();
                      clicked = true;
                      break;
                    }
                  }
                  if (!clicked && radios[0]) {
                    // Default to first option if no match
                    const wrapper = radios[0].closest('.ant-radio-wrapper');
                    radios[0].click();
                    if (wrapper) wrapper.click();
                  }
                  filled++;
                  found = true;
                  break;
                }
                
                // Textarea
                const textarea = row.querySelector('textarea.ant-input, textarea');
                if (textarea) {
                  safeSet(textarea, ans.answer);
                  filled++;
                  found = true;
                  break;
                }
                
                // Checkbox
                const checkbox = row.querySelector('.ant-checkbox-input');
                if (checkbox) {
                  const should = ['yes','true','1','agree','confirm'].includes(ans.answer.toLowerCase().trim());
                  if (should !== checkbox.checked) {
                    checkbox.click();
                    const wrapper = checkbox.closest('.ant-checkbox-wrapper');
                    if (wrapper) wrapper.click();
                  }
                  filled++;
                  found = true;
                  break;
                }
              }
              
              if (!found) {
                console.log('Turing: could not find row for:', ans.label);
              }
              
            } else if (isGF) {
              const containers = document.querySelectorAll('.Qr7Oae, .freebirdFormviewerViewItemsItemItem, .geS5n');
              for (const c of containers) {
                const title = c.querySelector('.M7eMe, .HoXoMd, .freebirdFormviewerComponentsQuestionBaseTitle');
                if (!title || !title.textContent.trim().includes(ans.label.substring(0, 50))) continue;

                const inp = c.querySelector('input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input:not([type]), textarea');
                if (inp) { safeSet(inp, ans.answer); filled++; break; }

                const radios = c.querySelectorAll('[role="radio"]');
                if (radios.length > 0) {
                  const target = ans.answer.toLowerCase();
                  let clicked = false;
                  for (const r of radios) {
                    const lbl = (r.querySelector('.YEVVod, .ulDsOb, span')?.textContent || r.textContent || '').toLowerCase().trim();
                    if (lbl.includes(target) || target.includes(lbl)) { r.click(); clicked = true; break; }
                  }
                  if (!clicked && radios[0]) radios[0].click();
                  filled++; break;
                }

                const checks = c.querySelectorAll('[role="checkbox"]');
                if (checks.length > 0) {
                  const target = ans.answer.toLowerCase();
                  for (const ch of checks) {
                    const lbl = (ch.querySelector('.YEVVod, .ulDsOb, span')?.textContent || ch.textContent || '').toLowerCase().trim();
                    if (lbl.includes(target) || target.includes(lbl)) { ch.click(); }
                  }
                  filled++; break;
                }
              }
            } else if (ans.selector) {
              const el = document.querySelector(ans.selector);
              if (el) {
                if (ans.type === 'select' || ans.type === 'select-one') {
                  const opts = Array.from(el.options);
                  const target = ans.answer.toLowerCase();
                  const match = opts.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()))
                             || opts.find(o => o.value.toLowerCase().includes(target));
                  if (match) { el.value = match.value; el.dispatchEvent(new Event('change', {bubbles:true})); }
                } else if (ans.type === 'checkbox') {
                  const should = ['yes','true','1','agree'].includes(ans.answer.toLowerCase());
                  if (should !== el.checked) el.click();
                } else if (ans.type === 'radio') {
                  const radios = document.querySelectorAll('input[type="radio"][name="' + el.name + '"]');
                  for (const r of radios) {
                    const lbl = (r.closest('label')?.textContent || r.value).toLowerCase();
                    if (lbl.includes(ans.answer.toLowerCase())) { r.click(); break; }
                  }
                } else {
                  safeSet(el, ans.answer);
                }
                filled++;
              }
            }
          } catch (err) { console.error('Fill error:', err); }
        }
        return 'filled:' + filled;
      })();
    `;
  }

  // Build auto-submit script with proper mouse events for Google Forms
  function buildAutoSubmitScript() {
    return `
      (async function() {
        // Helper: scroll into view + real click sequence
        function realClick(el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Small delay to let scroll finish, then click
          el.focus();
          el.click(); // Native click first (most reliable for Google Forms)
          // Also dispatch full mouse event sequence as backup
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
          el.dispatchEvent(new MouseEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new MouseEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
        }

        const isGF = window.location.hostname.includes('docs.google.com');
        if (isGF) {
          // Google Forms submit button selectors (ordered by reliability)
          const selectors = [
            '[jsname="M2UYVd"]',                                           // Modern GF submit
            '[aria-label="Submit"]',                                       // Aria label
            '.freebirdFormviewerViewNavigationSubmitButton',                // Legacy GF
            '.uArJ5e.UQuaGc.Y5sE8d.VkkpIf.QvWxOd',                       // Material button classes
            'div[role="button"] span',                                     // Generic material button
          ];

          // Try each selector
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              // For span inside button, click the parent button
              const btn = el.closest('[role="button"]') || el;
              realClick(btn);
              return 'submitted';
            }
          }

          // Fallback: Find by text content "Submit" or "Send"
          const allBtns = document.querySelectorAll('[role="button"], button');
          for (const b of allBtns) {
            const txt = b.textContent.trim().toLowerCase();
            if (txt === 'submit' || txt === 'send' || txt === 'next') {
              realClick(b);
              return 'submitted';
            }
          }

          return 'no submit button found (Google Form)';
        } else {
          // ── Wellfound modal: specific data-test selector ──
          const isWellfound = window.location.hostname.includes('wellfound.com') ||
                              window.location.hostname.includes('angel.co');
          if (isWellfound) {
            const wfBtn = document.querySelector('[data-test="JobApplicationModal--SubmitButton"]');
            if (wfBtn) {
              // Scroll into view first — the modal may need to be scrolled
              wfBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Wait for scroll to settle
              await new Promise(r => setTimeout(r, 400));
              realClick(wfBtn);
              return 'submitted';
            }
            // Fallback: button containing "Send application" text
            const allBtns = document.querySelectorAll('button');
            for (const b of allBtns) {
              if (b.textContent.trim().toLowerCase().includes('send application')) {
                b.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(r => setTimeout(r, 400));
                realClick(b);
                return 'submitted';
              }
            }
          }

          // Standard forms — try multiple approaches
          // 1. Standard submit button
          const submitBtn = document.querySelector(
            'button[type="submit"], input[type="submit"], ' +
            'button.submit, .btn-submit, [data-testid*="submit"], ' +
            'button[name="submit"], .submit-button, #submit-btn'
          );
          if (submitBtn) { realClick(submitBtn); return 'submitted'; }

          // 2. Button with submit-like text
          const allBtns = document.querySelectorAll('button, [role="button"], a.btn');
          for (const b of allBtns) {
            const txt = b.textContent.trim().toLowerCase();
            if (['submit', 'apply', 'send application', 'send', 'save', 'continue', 'next'].includes(txt) ||
                txt.includes('submit') || txt.includes('apply now') || txt.includes('send application')) {
              realClick(b);
              return 'submitted';
            }
          }

          // 3. Form.submit() as last resort
          const form = document.querySelector('form');
          if (form) { form.submit(); return 'submitted'; }

          return 'no submit button found';
        }
      })();
    `;
  }

  // ═══ LINKEDIN AUTO APPLY ENGINE ═══
  let liInjectorScript = '';
  let liIsRunning = false;
  let liIsPaused = false;
  let liShouldStop = false;
  let liAppliedCount = 0;
  let liSkippedCount = 0;
  let liFailedCount = 0;
  let liBeepOscillator = null;

  // Play continuous beep using Web Audio API — no file needed
  function liStartBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      liBeepOscillator = { oscillator: osc, context: ctx };
    } catch (e) { console.warn('Beep failed:', e); }
  }

  function liStopBeep() {
    if (liBeepOscillator) {
      try {
        liBeepOscillator.oscillator.stop();
        liBeepOscillator.context.close();
      } catch (e) { }
      liBeepOscillator = null;
    }
  }

  async function liDelay(ms) {
    await new Promise(r => setTimeout(r, ms));
  }

  async function liRandomDelay(minSec, maxSec) {
    const ms = Math.floor(Math.random() * (maxSec - minSec) * 1000 + minSec * 1000);
    await liDelay(ms);
  }

  async function liWaitIfPaused() {
    while (liIsPaused && !liShouldStop) {
      await liDelay(500);
    }
  }

  function liUpdateProgress(currentJobTitle) {
    const limit = parseInt($('#li-apply-limit').value) || 25;
    $('#li-applied-count').textContent = liAppliedCount;
    $('#li-skipped-count').textContent = liSkippedCount;
    $('#li-failed-count').textContent = liFailedCount;
    const pct = Math.round((liAppliedCount / limit) * 100);
    $('#li-progress-bar').style.width = Math.min(pct, 100) + '%';
    if (currentJobTitle) {
      $('#li-current-job').textContent = currentJobTitle;
    }
    statusText.textContent = `LinkedIn: ${liAppliedCount}/${limit} applied`;
  }

  async function liInject(wv, action, options = {}) {
    if (!liInjectorScript) {
      liInjectorScript = await window.api.engine.getLinkedInInjector();
    }

    const fieldMap = await window.api.profile.getFieldMap();
    const opts = { action, overwrite: true, ...options };

    const script = liInjectorScript
      .replace('FIELD_MAP_PLACEHOLDER', JSON.stringify(fieldMap))
      .replace('USER_PROFILE_PLACEHOLDER', JSON.stringify(profile))
      .replace('OPTIONS_PLACEHOLDER', JSON.stringify(opts));

    const resultJson = await wv.executeJavaScript(script);
    return JSON.parse(resultJson);
  }

  async function linkedinAutoApply() {
    if (liIsRunning) {
      toast('LinkedIn automation is already running!', 'warning');
      return;
    }

    const wv = webviewContainer.querySelector(`#${activeTabId}`);
    if (!wv) { toast('Open LinkedIn job search first!', 'error'); return; }

    const limit = parseInt($('#li-apply-limit').value) || 25;
    const delaySec = parseInt($('#li-delay').value) || 5;

    // Save latest profile
    profile = collectProfile();
    await window.api.profile.save(profile);

    liIsRunning = true;
    liShouldStop = false;
    liIsPaused = false;
    liAppliedCount = 0;
    liSkippedCount = 0;
    liFailedCount = 0;

    // Show controls
    $('#btn-li-start').style.display = 'none';
    $('#btn-li-pause').style.display = '';
    $('#btn-li-stop').style.display = '';
    $('#li-progress-section').style.display = '';
    leftPanel.classList.add('open');

    log('accent', '🚀 LinkedIn Easy Apply automation started!');
    log('info', `📋 Target: ${limit} applications, delay: ${delaySec}s`);
    liUpdateProgress('Scanning jobs...');

    try {
      let pageAttempts = 0;
      const maxPageAttempts = 20; // Safety limit

      while (liAppliedCount < limit && !liShouldStop && pageAttempts < maxPageAttempts) {
        pageAttempts++;
        await liWaitIfPaused();

        // Step 1: Scan for job cards
        log('info', '🔍 Scanning job cards on current page...');
        await liDelay(2000);
        const scanResult = await liInject(wv, 'scanJobs');

        if (!scanResult.success || !scanResult.data.jobs || scanResult.data.jobs.length === 0) {
          log('warn', '⚠️ No job cards found. Trying to load more...');
          const scrollResult = await liInject(wv, 'scrollJobList');
          if (!scrollResult.success) {
            log('error', '❌ No more jobs available. Stopping.');
            break;
          }
          await liDelay(3000);
          continue;
        }

        const jobs = scanResult.data.jobs;
        log('info', `📃 Found ${jobs.length} job cards`);

        // Step 2: Process each job
        for (let i = 0; i < jobs.length; i++) {
          if (liShouldStop || liAppliedCount >= limit) break;
          await liWaitIfPaused();

          const job = jobs[i];

          // Skip already-applied jobs
          if (job.isApplied) {
            log('info', `⏭️ Already applied: ${job.title}`);
            liSkippedCount++;
            liUpdateProgress(job.title);
            continue;
          }

          log('accent', `\n[${liAppliedCount + 1}/${limit}] 📝 ${job.title} at ${job.company}`);
          liUpdateProgress(job.title);

          try {
            // Click on the job card
            const clickResult = await liInject(wv, 'clickJob', { jobIndex: i, jobId: job.jobId });
            if (!clickResult.success) {
              log('warn', `⚠️ Could not click job card: ${clickResult.error}`);
              liSkippedCount++;
              liUpdateProgress();
              continue;
            }

            await liRandomDelay(2, 4);

            // Click Easy Apply button
            const easyApplyResult = await liInject(wv, 'clickEasyApply');
            if (!easyApplyResult.success) {
              if (easyApplyResult.error === 'ALREADY_APPLIED') {
                log('info', `⏭️ Already applied: ${job.title}`);
              } else if (easyApplyResult.error === 'EXTERNAL_APPLY') {
                log('info', `⏭️ External apply (not Easy Apply): ${job.title}`);
              } else {
                log('warn', `⚠️ No Easy Apply button: ${easyApplyResult.error}`);
              }
              liSkippedCount++;
              liUpdateProgress();
              continue;
            }

            // Wait for modal to open
            await liDelay(2000);

            // Get job description ONCE before filling steps (plain text)
            let jobDescText = '';
            try {
              const jdResult = await liInject(wv, 'getJobDescription');
              if (jdResult.success && jdResult.data) {
                const jd = jdResult.data;
                jobDescText = [
                  `Title: ${jd.title}`,
                  `Company: ${jd.company}`,
                  `Location: ${jd.location}`,
                  jd.workTypes?.length ? `Type: ${jd.workTypes.join(', ')}` : '',
                  jd.companyDetails ? `Industry: ${jd.companyDetails}` : '',
                  '',
                  'Job Description:',
                  jd.description || ''
                ].filter(Boolean).join('\n');
                log('info', `  📋 Got job description (${jobDescText.length} chars)`);
              }
            } catch (e) { log('warn', '  ⚠️ Could not get job description'); }

            // Process multi-step form
            let stepCount = 0;
            const maxSteps = 15;
            let applicationSubmitted = false;
            let consecutiveReviews = 0;
            const MAX_CONSECUTIVE_REVIEWS = 5;

            while (stepCount < maxSteps && !liShouldStop) {
              stepCount++;
              await liWaitIfPaused();

              log('info', `  📄 Step ${stepCount} — Filling form fields...`);

              // Fill current step
              const fillResult = await liInject(wv, 'fillStep');

              if (!fillResult.success) {
                if (fillResult.error === 'NO_MODAL_FOUND') {
                  log('info', '  Modal closed, checking status...');
                  await liDelay(1000);
                  const statusResult = await liInject(wv, 'checkStatus');
                  if (statusResult.success && statusResult.data.applicationSent) {
                    applicationSubmitted = true;
                  }
                  break;
                }
                log('warn', `  ⚠️ Fill error: ${fillResult.error}`);
                break;
              }

              const stepData = fillResult.data;
              const profileFilled = stepData.filledFields.filter(f => f.source === 'profile').length;
              const aiFilled = stepData.filledFields.filter(f => f.source === 'ai').length;
              log('info', `  ✏️ Filled ${profileFilled} from profile, ${aiFilled} from AI, ${stepData.skippedFields.length} skipped`);

              // Handle unknown fields with AI — send ALL questions at once with job description
              if (stepData.unknownFields.length > 0) {
                log('accent', `  🤖 Asking AI for ${stepData.unknownFields.length} unknown questions...`);

                // Build a combined prompt with all questions + job description context
                const questionsForAI = stepData.unknownFields.map(f => {
                  let q = { label: f.label, type: f.type, required: f.required };
                  if (f.options) q.options = f.options;
                  return q;
                });

                // Inject job preference into the profile context so AI can answer accordingly
                const profileWithPreference = {
                  ...profile,
                  jobPreference: settings.jobPreference || 'all'
                };

                try {
                  const aiAnswers = await window.api.ai.answerQuestions({
                    questions: questionsForAI,
                    jobDescription: jobDescText,
                    jobContext: {
                      title: job.title,
                      company: job.company,
                      description: jobDescText
                    },
                    userProfile: profileWithPreference
                  });

                  console.log(`🤖 AI answers received (${(aiAnswers || []).length} total):`, JSON.stringify(aiAnswers, null, 2));

                  // Filter valid answers
                  const validAiAnswers = (aiAnswers || []).filter(a => a && a.answer && a.answer.trim() && a.answer !== 'N/A');
                  console.log(`🤖 Valid AI answers (${validAiAnswers.length}):`, JSON.stringify(validAiAnswers, null, 2));

                  // ── UNPAID JOB DETECTION ──
                  // If user selected "Only Paid" and AI got an unpaid/no-equity question,
                  // check if any answer signals this is an unpaid role.
                  if ((settings.jobPreference || 'all') === 'paid') {
                    const unpaidSignalAnswer = (aiAnswers || []).find(a => {
                      const lbl = (a.label || '').toLowerCase();
                      const isUnpaidQuestion = lbl.includes('unpaid') || lbl.includes('no equity') ||
                        lbl.includes('no compensation') || lbl.includes('without pay') ||
                        lbl.includes('no salary') || lbl.includes('volunteer') ||
                        (lbl.includes('willing') && (lbl.includes('unpaid') || lbl.includes('equity')));
                      return isUnpaidQuestion;
                    });
                    if (unpaidSignalAnswer) {
                      // This job is explicitly unpaid — skip it
                      log('warn', `⛔ SKIPPING unpaid job: "${job.title}" — You have set "Only Paid Jobs" preference`);
                      toast(`⛔ Skipped unpaid job: ${job.title}`, 'warning');
                      liSkippedCount++;
                      liUpdateProgress();
                      // Dismiss the modal and move to next job
                      try { await liInject(wv, 'dismissModal'); } catch (e) {}
                      await liDelay(1500);
                      applicationSubmitted = false;
                      break; // Break out of the step while-loop for this job
                    }
                  }

                  // Log AI answers to Logs panel with copy buttons
                  if (validAiAnswers.length > 0) {
                    logAiAnswers(validAiAnswers);
                    const aiFillResult = await liInject(wv, 'fillStep', { aiAnswers: validAiAnswers });
                    if (aiFillResult.success) {
                      const newAiFilled = aiFillResult.data.filledFields.filter(f => f.source === 'ai').length;
                      log('success', `  ✅ AI filled ${newAiFilled} additional fields`);
                      console.log('✅ aiFillResult.data:', JSON.stringify(aiFillResult.data, null, 2));
                    } else {
                      console.warn('⚠️ aiFillResult failed:', aiFillResult);
                    }
                  } else {
                    log('warn', `  ⚠️ AI returned no valid answers for ${questionsForAI.length} questions`);
                  }
                } catch (aiErr) {
                  log('error', `  ❌ AI error: ${aiErr.message}`);
                }
              }

              // Handle file upload (resume)
              if (stepData.hasFileUpload && stepData.fileUploadSelectors.length > 0) {
                const resumePath = profile.resumePath || settings.resumePath || '';
                if (resumePath) {
                  log('accent', `  📎 Uploading resume...`);
                  const webContentsId = wv.getWebContentsId();
                  for (const fileField of stepData.fileUploadSelectors) {
                    try {
                      let pathToUpload = resumePath;
                      if (fileField.label && fileField.label.toLowerCase().includes('cover letter')) {
                        const coverLetterPath = profile.coverLetterPath || '';
                        if (coverLetterPath) {
                          pathToUpload = coverLetterPath;
                          log('accent', `📎 Uploading cover letter...`);
                        }
                      }
                      const uploadResult = await window.api.engine.uploadFile({
                        webContentsId,
                        selector: fileField.selector,
                        filePath: pathToUpload
                      });
                      if (uploadResult.success) {
                        log('success', `  ✅ Resume uploaded`);
                      } else {
                        log('warn', `  ⚠️ Upload: ${uploadResult.error}`);
                      }
                    } catch (err) {
                      log('error', `  ❌ Upload error: ${err.message}`);
                    }
                  }
                  await liDelay(1500);
                } else {
                  log('warn', '  ⚠️ Resume upload field found but no resume path set');
                }
              }

              await liDelay(800);

              // Click Next / Review / Submit
              const nextResult = await liInject(wv, 'nextStep');
              if (!nextResult.success) {
                log('warn', `  ⚠️ No navigation button found: ${nextResult.error}`);
                await liInject(wv, 'dismissModal');
                await liDelay(1000);
                break;
              }

              log('info', `  ➡️ Clicked: ${nextResult.data.clicked}`);

              // ═══ REVIEW LOOP PROTECTION ═══
              if (nextResult.data.clicked === 'review') {
                consecutiveReviews++;
                log('info', `  🔄 Review click #${consecutiveReviews}/${MAX_CONSECUTIVE_REVIEWS}`);

                if (consecutiveReviews >= MAX_CONSECUTIVE_REVIEWS) {
                  log('error', `  🚨 Review button clicked ${MAX_CONSECUTIVE_REVIEWS}+ times — STUCK! Playing alert...`);
                  // Start continuous beep
                  liStartBeep();
                  liIsPaused = true;
                  $('#btn-li-pause').innerHTML = '<span class="material-icons-round">play_arrow</span> Resume';
                  // Show alert popup — user must click OK
                  alert(`⚠️ STUCK: "Review" button has been clicked ${MAX_CONSECUTIVE_REVIEWS} times in a row without progress.\n\nPlease check this application manually in the browser, then click OK and Resume to continue.`);
                  // Stop beep after user clicks OK
                  liStopBeep();
                  // Reset counter — user may resume or stop
                  consecutiveReviews = 0;
                  continue; // Stay in the while loop, paused
                }
              } else {
                // Reset counter if any other button was clicked
                consecutiveReviews = 0;
              }

              if (nextResult.data.clicked === 'submit') {
                await liDelay(3000);
                const statusResult = await liInject(wv, 'checkStatus');
                if (statusResult.success && statusResult.data.applicationSent) {
                  applicationSubmitted = true;
                } else {
                  if (statusResult.data?.validationErrors?.length > 0) {
                    log('warn', `  ⚠️ Validation errors: ${statusResult.data.validationErrors.join(', ')}`);
                  }
                  await liDelay(2000);
                  const retry = await liInject(wv, 'checkStatus');
                  if (retry.success && retry.data.applicationSent) {
                    applicationSubmitted = true;
                  }
                }
                break;
              }

              // Wait for next step to load
              await liDelay(1500);
            }

            if (applicationSubmitted) {
              liAppliedCount++;
              log('success', `✅ Applied to: ${job.title} at ${job.company}`);
              // Dismiss any post-submit modal
              await liDelay(1000);
              try { await liInject(wv, 'dismissModal'); } catch (e) { }
            } else {
              liFailedCount++;
              log('warn', `❌ Could not complete application for: ${job.title}`);
              // Dismiss modal to clean up
              try {
                await liInject(wv, 'dismissModal');
                await liDelay(1500);
              } catch (e) { }
            }

            liUpdateProgress();

            // Random delay between jobs
            log('info', `⏳ Waiting ${delaySec}s before next job...`);
            await liRandomDelay(delaySec, delaySec + 3);

          } catch (error) {
            liFailedCount++;
            log('error', `❌ Error with ${job.title}: ${error.message}`);
            liUpdateProgress();
            // Try to dismiss any open modal
            try { await liInject(wv, 'dismissModal'); } catch (e) { }
            await liDelay(2000);
          }
        }

        // Try next page of results
        if (liAppliedCount < limit && !liShouldStop) {
          log('info', '📄 Advancing to next page of results...');
          const scrollResult = await liInject(wv, 'scrollJobList');
          if (!scrollResult.success) {
            log('warn', '⚠️ No more pages available.');
            break;
          }
          await liDelay(3000);
        }
      }

    } catch (error) {
      log('error', `❌ LinkedIn engine error: ${error.message}`);
    } finally {
      liIsRunning = false;
      liIsPaused = false;

      // Reset UI
      $('#btn-li-start').style.display = '';
      $('#btn-li-pause').style.display = 'none';
      $('#btn-li-stop').style.display = 'none';

      const summary = `🏁 Done! Applied: ${liAppliedCount}, Skipped: ${liSkippedCount}, Failed: ${liFailedCount}`;
      log('success', summary);
      liUpdateProgress('Finished!');
      statusText.textContent = summary;
      toast(summary, 'success');

      // Save to history
      await window.api.history.add({
        url: 'LinkedIn Easy Apply',
        title: `Batch: ${liAppliedCount} applied`,
        filled: liAppliedCount,
        aiFilled: 0,
        skipped: liSkippedCount
      });
    }
  }

  // LinkedIn button handlers
  $('#btn-li-start').addEventListener('click', () => {
    if (!activeTabId) {
      toast('Open a LinkedIn job search page first!', 'warning');
      return;
    }
    const wv = webviewContainer.querySelector(`#${activeTabId}`);
    if (!wv) return;

    // Verify it's LinkedIn
    try {
      wv.executeJavaScript('window.location.hostname').then(hostname => {
        if (!hostname.includes('linkedin.com')) {
          toast('Navigate to LinkedIn Jobs search first!', 'warning');
          return;
        }
        linkedinAutoApply();
      });
    } catch (e) {
      linkedinAutoApply(); // Try anyway
    }
  });

  $('#btn-li-pause').addEventListener('click', () => {
    if (liIsPaused) {
      liIsPaused = false;
      $('#btn-li-pause').innerHTML = '<span class="material-icons-round">pause</span> Pause';
      log('info', '▶️ LinkedIn automation resumed');
    } else {
      liIsPaused = true;
      $('#btn-li-pause').innerHTML = '<span class="material-icons-round">play_arrow</span> Resume';
      log('info', '⏸️ LinkedIn automation paused');
    }
  });

  $('#btn-li-stop').addEventListener('click', () => {
    liShouldStop = true;
    liIsPaused = false;
    log('info', '🛑 LinkedIn automation stopping...');
  });

  // ═══ LOGGING ═══
  function log(level, msg) {
    const el = document.createElement('div');
    el.className = `log-line log-${level}`;
    el.textContent = msg;
    logsScroll.appendChild(el);
    logsScroll.scrollTop = logsScroll.scrollHeight;

    // Switch to logs panel to show activity
    if (level === 'error' || level === 'accent') {
      $$('.left-panel .panel-tab').forEach(b => b.classList.toggle('active', b.dataset.panel === 'logs'));
      $$('.left-panel .panel-content').forEach(c => c.classList.toggle('active', c.id === 'panel-logs'));
      if (!leftPanel.classList.contains('open')) leftPanel.classList.add('open');
    }
  }

  // Log AI answers as individual copyable blocks in the Logs panel
  function logAiAnswers(answers) {
    if (!answers || answers.length === 0) return;

    const header = document.createElement('div');
    header.className = 'log-line log-accent';
    header.textContent = `🤖 AI Answers (${answers.length}):`;
    logsScroll.appendChild(header);

    answers.forEach(ans => {
      const row = document.createElement('div');
      row.className = 'log-line log-ai-answer';
      row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;background:rgba(99,102,241,0.08);border-left:3px solid #6366f1;padding:5px 8px;margin:2px 0;border-radius:0 5px 5px 0;';

      const text = document.createElement('div');
      text.style.cssText = 'flex:1;min-width:0;word-break:break-word;font-size:11.5px;line-height:1.4;';
      text.innerHTML = `<span style="color:#a5b4fc;font-weight:600;">${escapeHtml(ans.label)}</span><br><span style="color:#e2e8f0;">${escapeHtml(ans.answer || '(no answer)')}</span>`;

      const copyBtn = document.createElement('button');
      copyBtn.title = 'Copy answer';
      copyBtn.style.cssText = 'background:rgba(255,255,255,0.08);border:none;border-radius:4px;cursor:pointer;color:#94a3b8;padding:3px 5px;flex-shrink:0;font-size:12px;display:flex;align-items:center;';
      copyBtn.innerHTML = '<span class="material-icons-round" style="font-size:13px;">content_copy</span>';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(`Q: ${ans.label}\nA: ${ans.answer}`).then(() => {
          copyBtn.innerHTML = '<span class="material-icons-round" style="font-size:13px;">check</span>';
          setTimeout(() => { copyBtn.innerHTML = '<span class="material-icons-round" style="font-size:13px;">content_copy</span>'; }, 1500);
        });
      };

      row.appendChild(text);
      row.appendChild(copyBtn);
      logsScroll.appendChild(row);
    });

    // Also show a "Copy All" button
    const copyAllRow = document.createElement('div');
    copyAllRow.style.cssText = 'padding:3px 8px;margin-bottom:4px;';
    const copyAllBtn = document.createElement('button');
    copyAllBtn.style.cssText = 'background:rgba(99,102,241,0.2);border:1px solid #6366f1;border-radius:5px;cursor:pointer;color:#a5b4fc;padding:3px 10px;font-size:11px;display:flex;align-items:center;gap:4px;';
    copyAllBtn.innerHTML = '<span class="material-icons-round" style="font-size:13px;">copy_all</span> Copy All Answers';
    copyAllBtn.onclick = () => {
      const allText = answers.map(a => `Q: ${a.label}\nA: ${a.answer || '(no answer)'}`).join('\n\n');
      navigator.clipboard.writeText(allText).then(() => {
        copyAllBtn.innerHTML = '<span class="material-icons-round" style="font-size:13px;">check</span> Copied!';
        setTimeout(() => { copyAllBtn.innerHTML = '<span class="material-icons-round" style="font-size:13px;">copy_all</span> Copy All Answers'; }, 2000);
      });
    };
    copyAllRow.appendChild(copyAllBtn);
    logsScroll.appendChild(copyAllRow);
    logsScroll.scrollTop = logsScroll.scrollHeight;
  }

  function updateStats() {
    $('#status-filled').textContent = `Filled: ${totalFilled}`;
    $('#status-ai').textContent = `AI: ${totalAI}`;
    $('#status-skipped').textContent = `Skipped: ${totalSkipped}`;
  }

  // ═══ TABS PERSISTENCE ═══
  async function saveTabs() {
    const data = tabs.map(t => ({ title: t.title, url: t.url }));
    await window.api.tabs.save(data);
  }

  async function loadSavedTabs() {
    const saved = await window.api.tabs.getAll();
    if (saved && saved.length > 0) {
      saved.forEach(t => createTab(t.url, t.title || 'Tab'));
    }
  }

  // ═══ TOAST ═══
  function toast(message, type = 'info') {
    const icons = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="material-icons-round">${icons[type]}</span><span>${escapeHtml(message)}</span>`;
    $('#toast-container').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateX(30px)';
      el.style.transition = 'all 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // ═══ WINDOW FOCUS — prevent address bar from stealing focus on tab switch ═══
  function dismissAddressBarFocus() {
    // Use a small timeout so Electron's internal focus management finishes first,
    // then we reclaim focus away from the address bar.
    setTimeout(() => {
      if (document.activeElement === addressInput) {
        addressInput.blur();
        if (activeTabId) {
          const wv = webviewContainer.querySelector(`#${activeTabId}`);
          if (wv) {
            try { wv.focus(); } catch (e) { }
          }
        }
      }
    }, 50);
  }

  // Fires when the user clicks back into the Electron window from another OS window
  window.addEventListener('focus', dismissAddressBarFocus);

  // Fires when page becomes visible again (e.g. switching virtual desktops / monitors)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) dismissAddressBarFocus();
  });

  // ═══ INIT ═══
  async function init() {
    await loadProfile();
    await loadSettings();
    await loadShortcuts(); // Load shortcuts
    await loadSavedTabs();

    // Pre-load injector scripts
    try { injectorScript = await window.api.engine.getInjectorScript(); } catch (e) { }
    try { liInjectorScript = await window.api.engine.getLinkedInInjector(); } catch (e) { }

    // If no tabs, show shortcuts
    if (tabs.length === 0) shortcutsPage.classList.add('active');

    // Open left panel by default on first launch
    if (!profile.firstName && !profile.fullName) {
      leftPanel.classList.add('open');
    }
    // Listen for new tab creation requests from main process
    if (window.api.tabs && window.api.tabs.onTabCreate) {
      window.api.tabs.onTabCreate((newTab) => {
        console.log('📂 Creating tab from main process:', newTab.url);
        createTab(newTab.url, newTab.title || 'Loading...');
        toast('Opened in new tab', 'success');
      });
    }
  }

  init();
});
