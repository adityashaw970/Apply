const { app, BrowserWindow, ipcMain, session } = require('electron');

// ─── Clean Chrome UA — strip 'Electron/' to pass Google sign-in checks ───
// Electron 39 ships Chromium 134. Defined at the TOP so every handler can use it.
const CLEAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const CLEAN_SEC_CH_UA = '"Not)A;Brand";v="99", "Google Chrome";v="134", "Chromium";v="134"';

// ─── Global crash guard for disposed Electron frames ───
// This prevents the "Render frame was disposed before WebFrameMain" crash
// from killing the entire app when a webview/popup is rapidly torn down.
process.on('uncaughtException', (err) => {
  if (
    err.message &&
    (err.message.includes('Render frame was disposed') ||
      err.message.includes('WebFrameMain') ||
      err.message.includes('ERR_FAILED') ||
      err.message.includes('Object has been destroyed'))
  ) {
    // Silently ignore — these are benign race conditions from torn-down webviews
    return;
  }
  // Re-throw anything that's a real crash
  console.error('\u274c Uncaught Exception:', err);
});

// ─── Command-line switches (BEFORE app ready) ───
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');
// NOTE: Do NOT disable OutOfBlinkCors — it breaks Google OAuth sign-in
// NOTE: Do NOT set disable-blink-features=AutomationControlled here;
//       it conflicts with some Google auth checks in newer Chromium.

app.commandLine.appendSwitch('disable-client-side-phishing-detection');
app.commandLine.appendSwitch('ignore-certificate-errors-spki-list');
app.commandLine.appendSwitch('log-level', '3');

// Completely block stderr SSL errors
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, encoding, callback) => {
  const str = chunk.toString ? chunk.toString() : chunk;

  // Block ALL SSL/certificate errors
  if (str.includes('SSL routines') ||
    str.includes('CERTIFICATE_VERIFY_FAILED') ||
    str.includes('OPENSSL_internal') ||
    str.includes('handshake.cc') ||
    str.includes('CertVerifyProcBuiltin') ||
    str.includes('pfSense') ||
    str.includes('error:1000007d')) {
    return true; // Completely suppress
  }

  return originalStderrWrite(chunk, encoding, callback);
};

const path = require('path');
const Store = require('electron-store');
const { ProfileStore } = require('./engine/profile-store');
const fs = require('fs');

// Hot reload in dev
try { require('electron-reloader')(module, { watchRenderer: true }); } catch (_) { }

const store = new Store();
const profileStore = new ProfileStore(store);

let mainWindow;

function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    resizable: true,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      partition: 'persist:massapply'
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.maximize();
  mainWindow.on('closed', () => { mainWindow = null; });
  // Handle certificate errors for webviews (for pfSense/corporate proxies)
  mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
    // Accept all certificates (for dev/corporate proxy environments)
    // In production, you should implement proper certificate validation
    callback(0); // 0 = accept, -2 = reject
  });
}

// ─── Pending file upload state (for Google Forms file chooser interception) ───
let pendingResumeUpload = null; // { filePath, resolve, reject, timeout }

// ─── OAuth / Google Sign-In URL detection (module-level so all handlers share it) ───
const OAUTH_HOSTS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'github.com/login',
  'api.twitter.com/oauth'
];
const isOAuthUrl = (url) => url && OAUTH_HOSTS.some(h => url.includes(h));

// Handle webview new-window events globally
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ url, disposition }) => {

    // Allow Google OAuth / Sign-In popups as real browser windows
    // (Google's GSI / One Tap button MUST open in a real popup — it won't work inside a webview tab)
    const isOAuthPopup = isOAuthUrl(url) ||
      url.includes('accounts.google.com') ||
      url.includes('/oauth') ||
      url.includes('/signin') ||
      url.includes('appleid.apple.com') ||
      url.includes('login.microsoftonline.com');

    if (isOAuthPopup) {
      console.log('🔐 Allowing OAuth popup:', url);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 650,
          autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:massapply',
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      };
    }

    // Allow Google Forms/Drive upload popups when a file upload is pending
    const isUploadPopup = pendingResumeUpload &&
      (url.includes('docs.google.com') || url.includes('drive.google.com') ||
        url.includes('accounts.google.com') || url.includes('picker'));

    if (isUploadPopup) {
      console.log('📎 Allowing upload popup:', url);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 700,
          autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:massapply',
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      };
    }

    // For all other URLs (e.g. job links opening in new tab):
    // Returning 'deny' in modern Electron swallows the event silently —
    // the renderer's 'new-window' listener never fires. Instead, send an
    // IPC message to the renderer to open it as an in-app tab.
    if (url && url !== 'about:blank') {
      console.log('🔗 Routing new-window to in-app tab via IPC:', url);
      // Use setImmediate so the handler return value is processed first
      setImmediate(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-in-new-tab', url);
        }
      });
    }

    // Always deny the native popup — we handle it via IPC above
    return { action: 'deny' };
  });

  // Auto-close OAuth popup windows once the auth flow finishes.
  // Google will redirect back to the site or close the popup via JS —
  // if the popup navigates away from accounts.google.com, the auth is done.
  contents.on('did-create-window', (popup) => {
    console.log('🪟 Popup window created');

    // Always use the clean UA — session is already set to CLEAN_UA,
    // but explicitly set it on the popup webContents too just in case.
    // Do NOT skip OAuth popups: Google needs to see a standard Chrome UA,
    // NOT the Electron UA, otherwise it shows "Couldn't sign you in".
    popup.webContents.setUserAgent(CLEAN_UA);

    popup.webContents.on('will-navigate', (navEvent, navUrl) => {
      console.log('🪟 Popup navigating to:', navUrl);
      // Re-assert clean UA after any navigation in the popup
      popup.webContents.setUserAgent(CLEAN_UA);
    });

    // When the popup finishes loading, check if the auth flow completed
    popup.webContents.on('did-navigate', (navEvent, navUrl) => {
      console.log('🪟 Popup navigated to:', navUrl);
      // Google often navigates to about:blank or a gsi/transform URL when done
      if (navUrl === 'about:blank' || navUrl.includes('gsi/transform')) {
        console.log('🔓 Auth flow appears complete, closing popup');
        setTimeout(() => {
          if (!popup.isDestroyed()) popup.close();
        }, 1500);
      }
    });
  });

  // Set up file chooser interception on ANY new webContents when upload is pending
  // This catches file dialogs opened inside Google's upload popup
  if (pendingResumeUpload) {
    const pending = pendingResumeUpload;
    // Guard helper — returns true if this webContents is still alive
    const alive = () => !contents.isDestroyed();

    const setupInterception = async () => {
      if (!alive()) return; // Frame already gone — bail out
      try {
        try { contents.debugger.attach('1.3'); } catch (e) { }
        if (!alive()) return;
        await contents.debugger.sendCommand('Page.enable');
        if (!alive()) return;
        await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });

        contents.debugger.on('message', async (evt, method, params) => {
          if (method === 'Page.fileChooserOpened' && pendingResumeUpload) {
            console.log('📎 File chooser opened, providing:', pending.filePath);
            try {
              if (!alive()) return;
              await contents.debugger.sendCommand('Page.handleFileChooser', {
                action: 'accept',
                files: [pending.filePath]
              });
              if (pendingResumeUpload && pendingResumeUpload.resolve) {
                clearTimeout(pendingResumeUpload.timeout);
                pendingResumeUpload.resolve({ success: true });
                pendingResumeUpload = null;
              }
            } catch (e) {
              console.error('File chooser handle error:', e.message);
            }
            try { if (alive()) contents.debugger.detach(); } catch (e) { }
          }
        });
      } catch (e) {
        // Silently ignore frame-disposed errors from rapid popup teardown
        if (!e.message?.includes('Render frame') && !e.message?.includes('destroyed')) {
          console.error('File chooser interception setup failed:', e.message);
        }
      }
    };

    // Set up now and also after the content loads (for popups)
    setupInterception();
    contents.on('did-finish-load', setupInterception);
  }
});

app.whenReady().then(() => {
  // ── STEP 1: Override UA at the SESSION level BEFORE the window is created ──
  // This is the only way to strip 'Electron/x.x.x' from the very first request.
  // webRequest.onBeforeSendHeaders fires too late for the initial TCP handshake.
  session.defaultSession.setUserAgent(CLEAN_UA);
  session.fromPartition('persist:massapply').setUserAgent(CLEAN_UA);

  // ── STEP 2: Create window (sessions are patched before any requests go out) ──
  createWindow();

  // ── STEP 3: Patch navigator.userAgent in every renderer process ──
  // Even with session.setUserAgent, the JS property navigator.userAgent can
  // still report the Electron UA inside the renderer. We override it via script.
  const uaScript = `
    Object.defineProperty(navigator, 'userAgent', {
      get: () => '${CLEAN_UA}',
      configurable: true
    });
    Object.defineProperty(navigator, 'appVersion', {
      get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      configurable: true
    });
  `;

  // Apply to every webContents when it finishes loading
  app.on('web-contents-created', (_, wc) => {
    wc.on('did-finish-load', () => {
      try { wc.executeJavaScript(uaScript).catch(() => { }); } catch (_) { }
    });
    // Also set it immediately on the webContents level
    try { wc.setUserAgent(CLEAN_UA); } catch (_) { }
  });

  // ── STEP 4: Per-domain header spoofing (skip OAuth domains) ──
  const filter = { urls: ['*://*/*'] };
  const setupStealthHeaders = (sess) => {
    sess.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      // NEVER tamper with Google sign-in / OAuth requests
      if (isOAuthUrl(details.url)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
      details.requestHeaders['User-Agent'] = CLEAN_UA;
      details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9';
      details.requestHeaders['Sec-CH-UA'] = CLEAN_SEC_CH_UA;
      details.requestHeaders['Sec-CH-UA-Mobile'] = '?0';
      details.requestHeaders['Sec-CH-UA-Platform'] = '"Windows"';
      callback({ requestHeaders: details.requestHeaders });
    });
  };
  setupStealthHeaders(session.defaultSession);
  setupStealthHeaders(session.fromPartition('persist:massapply'));

  // ── STEP 5: Permissions ──
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'notifications' || permission === 'media');
  });

  // ── STEP 6: Suppress noisy certificate error logs ──
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const msg = args.join(' ');
    if (msg.includes('CertVerifyProcBuiltin') || msg.includes('pfSense') ||
      msg.includes('pfBNG-DNSBL') || msg.includes('ERROR: No matching issuer')) return;
    originalConsoleError.apply(console, args);
  };
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Window Controls ───
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// ─── Screenshot ───
ipcMain.handle('window:screenshot', async () => {
  try {
    if (!mainWindow) return null;
    const image = await mainWindow.webContents.capturePage();
    const pngBuffer = image.toPNG();
    const base64 = pngBuffer.toString('base64');
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    console.error('Screenshot error:', err.message);
    return null;
  }
});

// ─── Tabs Persistence ───
ipcMain.handle('tabs:getAll', () => store.get('tabs', []));
ipcMain.handle('tabs:save', (_, tabs) => {
  store.set('tabs', tabs);
  return true;
});

// ─── Open URL in New Tab (NEW!) ───
ipcMain.handle('tabs:openInNewTab', (_, url) => {
  console.log('📂 Opening in new tab:', url);

  // Validate and format URL
  let formattedUrl = url;
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = 'https://' + formattedUrl;
  }

  // Get current tabs and add new one
  const tabs = store.get('tabs', []);
  const newTab = {
    id: Date.now(),
    url: formattedUrl,
    title: 'Loading...',
    active: true
  };

  // Deactivate all other tabs
  tabs.forEach(tab => tab.active = false);
  tabs.push(newTab);

  store.set('tabs', tabs);

  // Notify renderer to create the tab
  mainWindow?.webContents.send('tab:create', newTab);

  return newTab;
});
// ─── Profile ───
ipcMain.handle('profile:get', () => profileStore.getProfile());
ipcMain.handle('profile:save', (_, data) => { profileStore.saveProfile(data); return true; });
ipcMain.handle('profile:getFieldMap', () => profileStore.getFieldMap());

// ─── Settings ───
ipcMain.handle('settings:get', () => {
  return store.get('settings', {
    applyLimit: 50,
    delayBetweenApply: 3000,
    geminiApiKey: '',
    autoSubmit: true
  });
});
ipcMain.handle('settings:save', (_, settings) => { store.set('settings', settings); return true; });

// ─── Shortcuts ───
ipcMain.handle('shortcuts:get', () => store.get('shortcuts', []));
ipcMain.handle('shortcuts:save', (_, shortcuts) => { store.set('shortcuts', shortcuts); return true; });

// ─── Webview DevTools ───
ipcMain.handle('webview:openDevTools', (_, webContentsId) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (wc) {
      wc.openDevTools({ mode: 'detach' });
      return { success: true };
    }
    return { success: false, error: 'WebContents not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('webview:inspectElement', (_, { webContentsId, x, y }) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (wc) {
      wc.inspectElement(x, y);
      return { success: true };
    }
    return { success: false, error: 'WebContents not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── AI Answering ───
ipcMain.handle('ai:answerQuestions', async (_, { questions, jobContext, jobDescription, userProfile }) => {
  // Merge jobDescription into jobContext if provided
  if (jobDescription && jobContext) {
    jobContext.description = jobDescription;
  }
  const settings = store.get('settings', {});
  const apiKeys = settings.geminiApiKey || '';

  if (!apiKeys.trim()) {
    return questions.map(q => ({
      label: q.label,
      answer: '',
      error: 'No API key configured. Add one in Settings.'
    }));
  }

  try {
    const response = await fetch('http://localhost:3000/api/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions, jobContext, userProfile, apiKeys })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: 'Server error' }));
      console.error('❌ AI server error:', errData.error);
      return errData.answers || questions.map(q => ({
        label: q.label,
        answer: '',
        error: errData.error
      }));
    }

    const data = await response.json();
    return data.answers || [];
  } catch (err) {
    console.error('❌ AI handler error:', err.message);

    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      return questions.map(q => ({
        label: q.label,
        answer: '',
        error: '⚠️ AI Server not running! Start it with: npx nodemon server.js'
      }));
    }

    return questions.map(q => ({
      label: q.label,
      answer: '',
      error: err.message
    }));
  }
});

// ─── Native Click via CDP (for Google Forms jsaction buttons) ───
ipcMain.handle('engine:nativeClick', async (_, { webContentsId, selector }) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (!wc) return { success: false, error: 'WebContents not found' };

    try { wc.debugger.attach('1.3'); } catch (e) { }
    await wc.debugger.sendCommand('Runtime.enable');

    // Find element and get its center coordinates
    const evalResult = await wc.debugger.sendCommand('Runtime.evaluate', {
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          const rect = el.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()
      `,
      returnByValue: true
    });

    const coords = evalResult.result.value;
    if (!coords) {
      try { wc.debugger.detach(); } catch (e) { }
      return { success: false, error: 'Element not found: ' + selector };
    }

    // Small delay for scroll to complete
    await new Promise(r => setTimeout(r, 200));

    // Send native mouse events via CDP (truly trusted events)
    const { x, y } = coords;
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y
    });
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    });
    await new Promise(r => setTimeout(r, 50));
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    });

    try { wc.debugger.detach(); } catch (e) { }
    return { success: true };
  } catch (err) {
    console.error('❌ Native click error:', err.message);
    return { success: false, error: err.message };
  }
});

// ─── Smart File Upload (DataTransfer API — works on all forms) ───
// This is the PRIMARY upload method. It reads the file, injects it as a
// File object via the DataTransfer API, and sets it on the <input type=file>
// element. No file-chooser dialog needed.
ipcMain.handle('engine:smartUploadFile', async (_, { webContentsId, selector, filePath }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found: ' + filePath };
    }

    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (!wc) return { success: false, error: 'WebContents not found' };

    // Read file into base64
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Determine MIME type
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.txt': 'text/plain'
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    try { wc.debugger.attach('1.3'); } catch (e) { }
    await wc.debugger.sendCommand('Runtime.enable');

    // Inject the file via DataTransfer API
    const injectResult = await wc.debugger.sendCommand('Runtime.evaluate', {
      expression: `
        (function() {
          try {
            // Find the file input — try provided selector first, then fallback
            let fileInput = null;
            const selectors = [
              ${JSON.stringify(selector || '')},
              'input[type="file"]',
              'input[type="file"][accept*="pdf"]',
              'input[type="file"][accept*="doc"]',
              'input[accept*=".pdf"]',
              'input[accept*=".doc"]'
            ].filter(Boolean);

            for (const sel of selectors) {
              try {
                const el = document.querySelector(sel);
                if (el) { fileInput = el; break; }
              } catch(e) {}
            }

            // Deeper scan: find ANY file input on the page
            if (!fileInput) {
              const allInputs = document.querySelectorAll('input');
              for (const inp of allInputs) {
                if (inp.type === 'file') { fileInput = inp; break; }
              }
            }

            if (!fileInput) {
              return JSON.stringify({ success: false, error: 'No file input found on page' });
            }

            // Make visible if hidden (some forms hide the real input)
            const origDisplay = fileInput.style.display;
            const origVisibility = fileInput.style.visibility;
            const origOpacity = fileInput.style.opacity;
            if (getComputedStyle(fileInput).display === 'none') {
              fileInput.style.display = 'block';
            }
            if (getComputedStyle(fileInput).visibility === 'hidden') {
              fileInput.style.visibility = 'visible';
            }
            fileInput.style.opacity = '1';

            // Decode base64 to binary
            const base64 = ${JSON.stringify(base64Data)};
            const byteChars = atob(base64);
            const byteNums = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              byteNums[i] = byteChars.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNums);

            // Create File object
            const file = new File([byteArray], ${JSON.stringify(fileName)}, {
              type: ${JSON.stringify(mimeType)},
              lastModified: Date.now()
            });

            // Use DataTransfer to set the file on the input
            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;

            // Fire all the events the page might be listening for
            fileInput.dispatchEvent(new Event('input', { bubbles: true }));
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));

            // Also try firing a custom "drop" event on the nearest dropzone
            const dropzone = fileInput.closest('[class*="drop"], [class*="upload"], [class*="file"], form') || fileInput.parentElement;
            if (dropzone) {
              const dropEvent = new DragEvent('drop', {
                bubbles: true,
                dataTransfer: dt
              });
              try { dropzone.dispatchEvent(dropEvent); } catch(e) {}
            }

            // Restore original display
            fileInput.style.display = origDisplay;
            fileInput.style.visibility = origVisibility;
            fileInput.style.opacity = origOpacity;

            return JSON.stringify({ success: true, method: 'DataTransfer', fileName: ${JSON.stringify(fileName)} });
          } catch(e) {
            return JSON.stringify({ success: false, error: e.message });
          }
        })()
      `,
      returnByValue: true
    });

    try { wc.debugger.detach(); } catch (e) { }

    const resultVal = injectResult.result.value;
    if (typeof resultVal === 'string') {
      return JSON.parse(resultVal);
    }
    return { success: false, error: 'Unexpected result from injection' };
  } catch (err) {
    console.error('❌ Smart file upload error:', err.message);
    return { success: false, error: err.message };
  }
});

// ─── File Upload for Standard Forms (input[type=file]) — FALLBACK via CDP ───
ipcMain.handle('engine:uploadFile', async (_, { webContentsId, selector, filePath }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found: ' + filePath };
    }

    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (!wc) return { success: false, error: 'WebContents not found' };

    try { wc.debugger.attach('1.3'); } catch (e) { }

    const { root } = await wc.debugger.sendCommand('DOM.getDocument');

    // Try the provided selector first
    let nodeId = 0;
    const selectorsToTry = [selector, 'input[type="file"]'].filter(Boolean);

    for (const sel of selectorsToTry) {
      try {
        const result = await wc.debugger.sendCommand('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: sel
        });
        if (result.nodeId) { nodeId = result.nodeId; break; }
      } catch (e) { }
    }

    // Fallback: search all inputs for type=file
    if (!nodeId) {
      try {
        const allResult = await wc.debugger.sendCommand('DOM.querySelectorAll', {
          nodeId: root.nodeId,
          selector: 'input'
        });
        for (const nId of (allResult.nodeIds || [])) {
          const attrs = await wc.debugger.sendCommand('DOM.getAttributes', { nodeId: nId });
          const attrMap = {};
          for (let i = 0; i < attrs.attributes.length; i += 2) {
            attrMap[attrs.attributes[i]] = attrs.attributes[i + 1];
          }
          if (attrMap.type === 'file') { nodeId = nId; break; }
        }
      } catch (e) { }
    }

    if (!nodeId) {
      try { wc.debugger.detach(); } catch (e) { }
      return { success: false, error: 'File input not found with any selector' };
    }

    await wc.debugger.sendCommand('DOM.setFileInputFiles', {
      nodeId: nodeId,
      files: [filePath]
    });

    try { wc.debugger.detach(); } catch (e) { }
    return { success: true, method: 'CDP-setFileInputFiles' };
  } catch (err) {
    console.error('❌ File upload error:', err.message);
    return { success: false, error: err.message };
  }
});

// ─── Google Forms File Upload (proprietary picker) ───
ipcMain.handle('engine:googleFormsUpload', async (_, { webContentsId, filePath }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found: ' + filePath };
    }

    const { webContents } = require('electron');
    const wc = webContents.fromId(webContentsId);
    if (!wc) return { success: false, error: 'WebContents not found' };

    // Set up file chooser interception BEFORE clicking anything
    try { wc.debugger.attach('1.3'); } catch (e) { }
    await wc.debugger.sendCommand('Page.enable');
    await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });

    const uploadPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingResumeUpload = null;
        try { wc.debugger.detach(); } catch (e) { }
        reject(new Error('File upload timeout (20s) — try setting resume in standard form'));
      }, 20000);

      pendingResumeUpload = {
        filePath, resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        }, reject, timeout
      };

      wc.debugger.on('message', async (evt, method, params) => {
        if (method === 'Page.fileChooserOpened') {
          console.log('📎 File chooser opened on webview, providing:', filePath);
          clearTimeout(timeout);
          pendingResumeUpload = null;
          try {
            await wc.debugger.sendCommand('Page.handleFileChooser', {
              action: 'accept',
              files: [filePath]
            });
            resolve({ success: true });
          } catch (e) {
            resolve({ success: false, error: e.message });
          }
          try { wc.debugger.detach(); } catch (e) { }
        }
      });
    });

    // Click the upload trigger — broadened selectors
    await wc.debugger.sendCommand('Runtime.evaluate', {
      expression: `
        (function() {
          // Try multiple selectors for the upload button
          const selectors = [
            '[aria-label="Add file"]',
            '[jsname="mWZCyf"]',
            '[data-file-url]',
            '.e2CuFe',
            '.MjZfLe',
            '[jsname="qMDrSe"]'
          ];
          for (const sel of selectors) {
            const btn = document.querySelector(sel);
            if (btn) {
              btn.scrollIntoView({ block: 'center' });
              btn.click();
              return 'clicked: ' + sel;
            }
          }
          // Fallback: look for any upload-related button text
          const allBtns = document.querySelectorAll('[role="button"], button, a');
          for (const b of allBtns) {
            const txt = (b.textContent || '').toLowerCase();
            if (txt.includes('add file') || txt.includes('upload') || txt.includes('browse') || txt.includes('choose file') || txt.includes('attach')) {
              b.scrollIntoView({ block: 'center' });
              b.click();
              return 'clicked fallback: ' + txt.substring(0, 30);
            }
          }
          return 'not found';
        })()
      `,
      returnByValue: true
    });

    const result = await uploadPromise;
    return result;
  } catch (err) {
    pendingResumeUpload = null;
    console.error('❌ Google Forms upload error:', err.message);
    return { success: false, error: err.message };
  }
});

// ─── Get the injectable form-filler script ───
ipcMain.handle('engine:getInjectorScript', () => {
  const scriptPath = path.join(__dirname, 'engine', 'injector.js');
  return fs.readFileSync(scriptPath, 'utf-8');
});

// ─── Get the LinkedIn Easy Apply injector script ───
ipcMain.handle('engine:getLinkedInInjector', () => {
  const scriptPath = path.join(__dirname, 'engine', 'linkedin-injector.js');
  return fs.readFileSync(scriptPath, 'utf-8');
});

// ─── History ───
ipcMain.handle('history:get', () => store.get('applicationHistory', []));
ipcMain.handle('history:clear', () => { store.set('applicationHistory', []); return true; });
ipcMain.handle('history:add', (_, entry) => {
  const history = store.get('applicationHistory', []);
  history.push({ ...entry, date: new Date().toISOString() });
  if (history.length > 100) history.splice(0, history.length - 100);
  store.set('applicationHistory', history);
  return true;
});

// ─── Cache & Site Data ───
ipcMain.handle('app:getSiteData', async () => {
  try {
    const sess = session.fromPartition('persist:massapply');
    const cookies = await sess.cookies.get({});
    const domains = new Set();
    cookies.forEach(c => {
      let d = c.domain;
      if (d.startsWith('.')) d = d.substring(1);
      domains.add(d);
    });
    return Array.from(domains).sort();
  } catch (e) { console.error('Error getting site data:', e); return []; }
});

ipcMain.handle('app:clearAllSiteData', async () => {
  try {
    const sess = session.fromPartition('persist:massapply');
    await sess.clearStorageData();
    await sess.clearCache();
    // Also clear default session
    await session.defaultSession.clearStorageData();
    await session.defaultSession.clearCache();
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('app:clearSiteData', async (_, domain) => {
  try {
    const sess = session.fromPartition('persist:massapply');
    const cookies = await sess.cookies.get({});
    for (const c of cookies) {
      let d = c.domain;
      if (d.startsWith('.')) d = d.substring(1);
      if (d === domain) {
        let url = (c.secure ? 'https://' : 'http://') + c.domain + c.path;
        await sess.cookies.remove(url, c.name);
      }
    }
    await sess.clearStorageData({ origin: `https://${domain}` });
    await sess.clearStorageData({ origin: `http://${domain}` });
    await session.defaultSession.clearStorageData({ origin: `https://${domain}` });
    await session.defaultSession.clearStorageData({ origin: `http://${domain}` });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
