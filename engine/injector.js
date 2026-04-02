// ══════════════════════════════════════════════════════════
// MassApply — Injectable Form Filler (v3)
// Supports: Standard HTML forms + Google Forms
// Features: Overwrite mode, auto-submit, resume file detection
// ══════════════════════════════════════════════════════════

(function massApplyFiller(FIELD_MAP, USER_PROFILE, OPTIONS) {
  'use strict';

  const result = {
    filledCount: 0,
    skippedFields: [],
    unknownFields: [],
    errors: [],
    pageTitle: document.title,
    pageUrl: window.location.href,
    company: '',
    hasFileUpload: false,
    fileUploadSelectors: [],
    submittable: false
  };

  const OVERWRITE = OPTIONS.overwrite !== false; // Default: true
  const AUTO_SUBMIT = OPTIONS.autoSubmit === true;

  const isGoogleForm = window.location.hostname.includes('docs.google.com') &&
                        window.location.pathname.includes('/forms/');

  // Detect Turing job interest form (old ant-design based)
  const isTuringForm = (window.location.hostname.includes('turing.com') ||
                        window.location.hostname.includes('developers.turing.com')) &&
                       document.querySelector('.job-interest-form') !== null;

  // Detect new work.turing.com Radix UI dialog form
  const isWorkTuringForm = window.location.hostname.includes('turing.com') &&
                           !!document.querySelector('[data-slot="dialog-panel"]') &&
                           !!document.querySelector('[data-slot="card-title"]');

  // Detect Wellfound (AngelList Talent) job application modal
  // The modal may or may not carry data-test="JobApplication-Modal" — check multiple indicators.
  const isWellfound = (window.location.hostname.includes('wellfound.com') ||
                       window.location.hostname.includes('angel.co')) &&
                      !!(
                        document.querySelector('[data-test="JobApplication-Modal"]') ||
                        document.querySelector('[data-test="JobApplicationModal--SubmitButton"]') ||
                        document.querySelector('[class*="styles_modal"][class*="MFCOh"]') ||
                        document.querySelector('[class*="styles_modal__"]')
                      );

  // ═══ HELPER: safely set value on any input ═══
  function safeSetValue(el, value) {
    try {
      el.focus();
      // Try native setter first (works for React/Angular)
      try {
        const proto = el.tagName === 'TEXTAREA' 
          ? HTMLTextAreaElement.prototype 
          : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(el, value);
        } else {
          el.value = value;
        }
      } catch(e) {
        // Fallback: direct assignment
        el.value = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch(e) {
      // Last resort
      el.value = value;
    }
  }

  // ═══ GOOGLE FORMS HANDLER ═══
  function handleGoogleForm() {
    // Google Forms uses various container classes across versions
    const containers = document.querySelectorAll(
      '.Qr7Oae, .freebirdFormviewerViewItemsItemItem, .geS5n'
    );

    if (containers.length === 0) {
      result.errors.push('No Google Form questions found.');
      return;
    }

    const processedLabels = new Set();

    containers.forEach((container, idx) => {
      try {
        // Get question title
        const titleEl = container.querySelector(
          '.M7eMe, .HoXoMd, .freebirdFormviewerComponentsQuestionBaseTitle, [data-initial-value]'
        ) || container.querySelector('span[dir="auto"]');

        const label = titleEl ? titleEl.textContent.trim() : '';
        if (!label || processedLabels.has(label)) return;
        processedLabels.add(label);

        const isRequired = container.querySelector('.vnumgf, [aria-required="true"]') !== null;

        // Detect field type and fill
        const textInput = container.querySelector(
          'input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], input:not([type])'
        );
        const textArea = container.querySelector('textarea');
        const radioOptions = container.querySelectorAll('[role="radio"]');
        const checkboxOptions = container.querySelectorAll('[role="checkbox"]');
        const dropdown = container.querySelector('[role="listbox"]');
        const dateInputs = container.querySelectorAll('input[type="date"], input[aria-label*="Day"], input[aria-label*="Month"], input[aria-label*="Year"]');
        const fileInput = container.querySelector('input[type=\"file\"]');
        // Google Forms also uses custom upload buttons — detect any upload area
        const uploadArea = container.querySelector('[data-file-url], .e2CuFe, .MjZfLe, [jsname=\"qMDrSe\"], [jsname=\"mWZCyf\"], [aria-label=\"Add file\"]');
        // Also detect by text content — Google Forms shows "Add file" link/button
        let uploadBtn = null;
        if (!fileInput && !uploadArea) {
          const allClickables = container.querySelectorAll('[role=\"button\"], button, a, span, div');
          for (const el of allClickables) {
            const txt = (el.textContent || '').toLowerCase().trim();
            if (txt === 'add file' || txt === 'upload file' || txt === 'browse' || txt === 'choose file' || txt === 'attach file') {
              uploadBtn = el;
              break;
            }
          }
        }

        // Detect file upload (standard input OR Google Forms custom)
        if (fileInput || uploadArea || uploadBtn) {
          result.hasFileUpload = true;
          const sel = fileInput ? buildSelector(fileInput) : 'input[type=\"file\"]';
          result.fileUploadSelectors.push({ label, selector: sel, name: fileInput?.name || '', isGoogleFormsUpload: !fileInput });
        }

        // Match label to profile
        const matchedValue = matchField({ label, name: '' });

        if (textInput) {
          if (!OVERWRITE && textInput.value && textInput.value.trim() !== '') {
            result.skippedFields.push({ label, reason: 'Already filled' });
            return;
          }
          if (matchedValue) {
            safeSetValue(textInput, matchedValue.toString());
            result.filledCount++;
          } else {
            result.unknownFields.push({
              label, type: textInput.type || 'text', options: [],
              selector: buildSelector(textInput), name: textInput.name || '',
              required: isRequired
            });
          }
        } else if (textArea) {
          if (!OVERWRITE && textArea.value && textArea.value.trim() !== '') {
            result.skippedFields.push({ label, reason: 'Already filled' });
            return;
          }
          if (matchedValue) {
            safeSetValue(textArea, matchedValue.toString());
            result.filledCount++;
          } else {
            result.unknownFields.push({
              label, type: 'textarea', options: [],
              selector: buildSelector(textArea), name: textArea.name || '',
              required: isRequired
            });
          }
        } else if (radioOptions.length > 0) {
          const options = [];
          radioOptions.forEach(r => {
            const lbl = r.querySelector('.YEVVod, .ulDsOb, span')?.textContent?.trim() ||
                        r.getAttribute('data-value') || r.textContent.trim();
            if (lbl) options.push(lbl);
          });

          if (matchedValue) {
            clickBestOption(radioOptions, matchedValue.toString(), options);
            result.filledCount++;
          } else {
            result.unknownFields.push({
              label, type: 'radio', options,
              selector: '', name: '', required: isRequired
            });
          }
        } else if (checkboxOptions.length > 0) {
          const options = [];
          checkboxOptions.forEach(c => {
            const lbl = c.querySelector('.YEVVod, .ulDsOb, span')?.textContent?.trim() || c.textContent.trim();
            if (lbl) options.push(lbl);
          });

          if (matchedValue) {
            // For checkboxes, try to match multiple values
            const values = matchedValue.toString().split(',').map(v => v.trim().toLowerCase());
            checkboxOptions.forEach((c, i) => {
              if (options[i] && values.some(v => options[i].toLowerCase().includes(v) || v.includes(options[i].toLowerCase()))) {
                c.click();
              }
            });
            result.filledCount++;
          } else {
            result.unknownFields.push({
              label, type: 'checkbox', options,
              selector: '', name: '', required: isRequired
            });
          }
        } else if (dropdown) {
          if (matchedValue) {
            dropdown.click();
            setTimeout(() => {
              const opts = document.querySelectorAll('[role="option"], .exportOption');
              clickBestOption(opts, matchedValue.toString(),
                Array.from(opts).map(o => o.textContent.trim()));
            }, 500);
            result.filledCount++;
          } else {
            const existingOptions = [];
            dropdown.querySelectorAll('[data-value]').forEach(o => {
              existingOptions.push(o.getAttribute('data-value') || o.textContent.trim());
            });
            result.unknownFields.push({
              label, type: 'select', options: existingOptions,
              selector: '', name: '', required: isRequired
            });
          }
        } else if (dateInputs.length > 0) {
          if (matchedValue) {
            dateInputs.forEach(inp => safeSetValue(inp, matchedValue.toString()));
            result.filledCount++;
          } else {
            result.unknownFields.push({
              label, type: 'date', options: [],
              selector: buildSelector(dateInputs[0]), name: '', required: isRequired
            });
          }
        }
      } catch (err) {
        result.errors.push('Error processing question ' + (idx + 1) + ': ' + err.message);
      }
    });

    result.submittable = true; // Google Forms always have a submit button
  }

  function clickBestOption(els, value, labels) {
    const target = value.toLowerCase().trim();
    let bestIdx = -1, bestScore = 0;

    labels.forEach((lbl, i) => {
      const l = (lbl || '').toLowerCase().trim();
      if (l === target) { bestIdx = i; bestScore = 100; }
      else if (bestScore < 50 && (l.includes(target) || target.includes(l))) { bestIdx = i; bestScore = 50; }
      else if (bestScore < 25) {
        const words = target.split(/\s+/).filter(w => w.length > 1);
        const overlap = words.filter(w => l.includes(w)).length;
        if (overlap > 0 && overlap + 10 > bestScore) { bestIdx = i; bestScore = overlap + 10; }
      }
    });

    if (bestIdx >= 0 && els[bestIdx]) {
      els[bestIdx].click();
    }
  }

  // ═══ STANDARD HTML FORM HANDLER ═══
  function handleStandardForm() {
    const fields = scanFields();
    if (fields.length === 0) {
      result.errors.push('No fillable form fields found on this page.');
      return;
    }

    for (const field of fields) {
      // In overwrite mode, we always fill. Otherwise skip already-filled.
      if (!OVERWRITE && field.currentValue && field.currentValue.trim() !== '' &&
          field.type !== 'select' && field.type !== 'select-one') {
        result.skippedFields.push({ label: field.label, reason: 'Already filled' });
        continue;
      }

      const matchedValue = matchField(field);
      if (matchedValue && matchedValue.toString().trim() !== '') {
        const filled = fillField(field, matchedValue.toString());
        if (filled) result.filledCount++;
      } else {
        // ── Smart auto-fill for common select patterns ──
        // Don't waste AI calls on 200+ country code options
        if ((field.type === 'select' || field.type === 'select-one') && field.options.length > 20) {
          const lbl = field.label.toLowerCase();
          const nm = (field.name || '').toLowerCase();
          
          // Phone country code selects
          if (lbl.includes('country code') || lbl.includes('phone code') || lbl.includes('dial') ||
              nm.includes('countrycode') || nm.includes('country_code') || nm.includes('phone_code') ||
              nm.includes('dialcode') || nm.includes('dial_code') ||
              (lbl.includes('phone') && field.options.some(o => o.includes('(+')))) {
            // Find user's country from profile and match the calling code
            const userCountry = (USER_PROFILE.country || 'india').toLowerCase().trim();
            const filled = autoFillCountrySelect(field.element, userCountry, field.options);
            if (filled) { result.filledCount++; continue; }
          }
          
          // Country selects
          if (lbl.includes('country') || lbl.includes('nation') || lbl.includes('location') ||
              nm.includes('country') || nm === 'location') {
            const userCountry = (USER_PROFILE.country || 'india').toLowerCase().trim();
            const filled = autoFillCountrySelect(field.element, userCountry, field.options);
            if (filled) { result.filledCount++; continue; }
          }
          
          // State selects
          if (lbl.includes('state') || lbl.includes('province') || lbl.includes('region') ||
              nm.includes('state') || nm.includes('province')) {
            const userState = (USER_PROFILE.state || '').toLowerCase().trim();
            if (userState) {
              fillSelect(field.element, userState);
              result.filledCount++;
              continue;
            }
          }
        }
        
        // Gender selects (short option list)
        if ((field.type === 'select' || field.type === 'select-one') &&
            (field.label.toLowerCase().includes('gender') || 
             (field.name || '').toLowerCase().includes('gender'))) {
          const userGender = (USER_PROFILE.gender || '').toLowerCase().trim();
          if (userGender) {
            fillSelect(field.element, userGender);
            result.filledCount++;
            continue;
          }
        }
        
        // Cap options sent to AI — no point sending 200+ entries
        let cappedOptions = field.options;
        if (cappedOptions.length > 15) {
          cappedOptions = cappedOptions.slice(0, 10);
          cappedOptions.push('... (' + field.options.length + ' total options)');
        }

        // De-duplicate stuttered labels like "Phone country codePhone country code"
        let cleanLabel = field.label;
        if (cleanLabel.length > 10) {
          const half = Math.floor(cleanLabel.length / 2);
          const firstHalf = cleanLabel.substring(0, half);
          const secondHalf = cleanLabel.substring(half);
          if (firstHalf === secondHalf) cleanLabel = firstHalf;
        }

        result.unknownFields.push({
          label: cleanLabel, type: field.type, options: cappedOptions,
          selector: field.selector, name: field.name, required: field.required
        });
      }
    }

    // Detect if page has a submit button
    const submitBtn = document.querySelector(
      'button[type="submit"], input[type="submit"], .submit-btn, [data-testid*="submit"]'
    );
    result.submittable = !!submitBtn;

    // Detect file upload fields — find ALL file inputs for resume upload
    document.querySelectorAll('input[type="file"]').forEach(inp => {
      const label = getLabel(inp);
      result.hasFileUpload = true;
      result.fileUploadSelectors.push({
        label: label || 'File Upload',
        selector: buildSelector(inp),
        name: inp.name || ''
      });
    });

    // Also detect custom upload components (buttons, dropzones) that wrap hidden file inputs
    if (!result.hasFileUpload) {
      // Look for hidden file inputs (some forms hide them behind custom UI)
      document.querySelectorAll('input').forEach(inp => {
        if (inp.type === 'file') {
          const label = getLabel(inp);
          result.hasFileUpload = true;
          result.fileUploadSelectors.push({
            label: label || 'File Upload',
            selector: buildSelector(inp),
            name: inp.name || ''
          });
        }
      });

      // Look for upload buttons/zones that may trigger hidden file inputs
      if (!result.hasFileUpload) {
        const uploadKeywords = ['upload', 'resume', 'attach', 'browse', 'choose file', 'drag', 'drop file', 'cv', 'cover letter'];
        document.querySelectorAll('button, [role="button"], a, label, div[class*="upload"], div[class*="drop"], div[class*="file"]').forEach(el => {
          const text = (el.textContent || '').toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const className = (el.className || '').toLowerCase();
          if (uploadKeywords.some(kw => text.includes(kw) || ariaLabel.includes(kw) || className.includes(kw))) {
            // Check if there's a hidden file input nearby
            const nearbyInput = el.querySelector('input[type="file"]') || 
                                el.parentElement?.querySelector('input[type="file"]');
            if (nearbyInput) {
              result.hasFileUpload = true;
              result.fileUploadSelectors.push({
                label: text.substring(0, 60) || 'File Upload',
                selector: buildSelector(nearbyInput),
                name: nearbyInput.name || ''
              });
            }
          }
        });
      }
    }
  }

  // ─── Scan all fillable standard form fields ───
  function scanFields() {
    const fields = [];
    const inputs = document.querySelectorAll('input, select, textarea');

    inputs.forEach((el) => {
      if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(el.type)) return;
      if (el.offsetParent === null && el.type !== 'checkbox' && el.type !== 'radio') return;

      const label = getLabel(el);
      let options = [];
      if (el.tagName === 'SELECT') {
        options = Array.from(el.options).map(o => o.text.trim()).filter(Boolean);
      }

      fields.push({
        element: el,
        selector: buildSelector(el),
        tagName: el.tagName.toLowerCase(),
        type: el.type || (el.tagName === 'SELECT' ? 'select' : 'textarea'),
        label: label.substring(0, 200),
        name: el.name || '',
        currentValue: el.value || '',
        options,
        required: el.required || el.getAttribute('aria-required') === 'true'
      });
    });

    return fields;
  }

  // ─── Get human-readable label for a field ───
  function getLabel(el) {
    function isValidLabel(t) {
      if (!t || t.length === 0 || t.length > 150) return false;
      // Discard pure numbers, phone codes, specific short garbage (e.g. "+91", "12", "01 23 45 67 89")
      if (/^[\+\-\(\)\s\d]+$/.test(t)) return false;
      // Discard small non-alphabetic UI glyphs if that's all that exists
      if (t.length < 3 && !/[a-zA-Z]/.test(t)) return false;
      // If it resembles a placeholder like just numbers, discard
      return true;
    }

    if (el.id) {
      const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl && isValidLabel(lbl.textContent.trim())) return lbl.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      // Get only text, not input value
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea').forEach(c => c.remove());
      const text = clone.textContent.trim();
      if (isValidLabel(text)) return text;
    }

    // Google Forms parent question
    const gfParent = el.closest('.Qr7Oae, .freebirdFormviewerViewItemsItemItem, .geS5n');
    if (gfParent) {
      const title = gfParent.querySelector('.M7eMe, .HoXoMd');
      if (title && isValidLabel(title.textContent.trim())) return title.textContent.trim();
    }

    // Strong explicit indicators
    if (el.getAttribute('aria-label') && isValidLabel(el.getAttribute('aria-label'))) return el.getAttribute('aria-label');

    // Structure 1: Previous sibling of the input
    const prev = el.previousElementSibling;
    if (prev && ['LABEL', 'SPAN', 'P', 'DIV', 'H2', 'H3', 'H4', 'H5'].includes(prev.tagName)) {
      const t = prev.textContent.trim();
      if (isValidLabel(t)) return t;
    }

    // Structure 2: Next sibling of the input (very common for custom checkboxes: <input> <span>I agree...</span>)
    const next = el.nextElementSibling;
    if (next && ['LABEL', 'SPAN', 'P', 'DIV'].includes(next.tagName)) {
      const t = next.textContent.trim();
      if (isValidLabel(t)) return t;
    }

    // Structure 3: Parent level structural checks (for flex/grid and styled wrappers)
    const parent = el.parentElement;
    if (parent) {
      // Previous sibling of parent
      const parentPrev = parent.previousElementSibling;
      if (parentPrev && ['LABEL', 'SPAN', 'P', 'DIV', 'H2', 'H3', 'H4'].includes(parentPrev.tagName)) {
        const t = parentPrev.textContent.trim();
        if (isValidLabel(t)) return t; // Catch: <label>Phone</label> <div><input></div>
      }

      // Grandparent check (for extra deep components like country code selectors)
      const grandParent = parent.parentElement;
      if (grandParent) {
        const gpPrev = grandParent.previousElementSibling;
        if (gpPrev && ['LABEL', 'SPAN', 'P', 'DIV', 'H3', 'H4'].includes(gpPrev.tagName)) {
          const t = gpPrev.textContent.trim();
          if (isValidLabel(t)) return t;
        }
        
        // Search for a loose label inside the same component box
        const looseLabel = grandParent.querySelector('label');
        if (looseLabel) {
           const t = looseLabel.textContent.trim();
           if (isValidLabel(t)) return t;
        }
      }

      // Direct text nodes matching
      const textNodes = Array.from(parent.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .filter(t => isValidLabel(t));
      if (textNodes.length > 0) return textNodes[0];
    }

    // Last resorts (often misleading like "01 23 45 67 89" or "Select an Option")
    if (el.placeholder) return el.placeholder;
    if (el.name) return el.name.replace(/[_\-\[\]]/g, ' ').trim();
    return '';
  }

  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name) + '"]';
    
    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.id) {
        path.unshift('#' + CSS.escape(current.id));
        break;
      }
      let selector = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + idx + ')';
        }
      }
      path.unshift(selector);
      current = parent;
    }
    return path.join(' > ');
  }

  // ─── Match a field label to profile data ───
  function matchField(field) {
    const searchTerms = [
      field.label.toLowerCase().trim(),
      (field.name || '').toLowerCase().replace(/[_\-]/g, ' ').trim()
    ].filter(t => t.length > 0);

    // AI Fast-track: if the label is a sentence or complex question, send it to the AI for accurate parsing
    const labelTerm = searchTerms[0] || '';
    if (labelTerm.split(/\s+/).length > 4 || /how|why|describe|tell me|explain|what/i.test(labelTerm)) {
      return null;
    }

    // Direct match
    for (const term of searchTerms) {
      if (FIELD_MAP[term] && FIELD_MAP[term].toString().trim() !== '') return FIELD_MAP[term];
    }
    // Partial phrase match (require word boundaries to avoid 'tel' matching 'tell')
    const sortedEntries = Object.entries(FIELD_MAP).sort((a, b) => b[0].length - a[0].length);

    for (const term of searchTerms) {
      for (const [key, value] of sortedEntries) {
        if (!value || value.toString().trim() === '') continue;
        
        // Ensure special regex characters in key are escaped safely
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedKey}\\b`, 'gi');
        
        if (regex.test(term)) {
          return value;
        }
      }
    }
    // Word overlap
    for (const term of searchTerms) {
      const termWords = term.split(/\s+/).filter(w => w.length > 2);
      for (const [key, value] of sortedEntries) {
        if (!value || value.toString().trim() === '') continue;
        const keyWords = key.split(/\s+/).filter(w => w.length > 2);
        const overlap = termWords.filter(w => keyWords.includes(w));
        if (overlap.length > 0 && keyWords.length > 0 && overlap.length >= keyWords.length * 0.5) {
          return value;
        }
      }
    }
    return null;
  }

  // ─── Fill a standard HTML field ───
  function fillField(field, value) {
    const el = field.element;
    try {
      switch (field.type) {
        case 'select':
        case 'select-one':
          fillSelect(el, value); break;
        case 'checkbox':
          fillCheckbox(el, value); break;
        case 'radio':
          fillRadio(el, field, value); break;
        default:
          safeSetValue(el, value); break;
      }
      return true;
    } catch (err) {
      result.errors.push('Fill error on "' + field.label + '": ' + err.message);
      return false;
    }
  }

  function fillSelect(el, value) {
    const target = value.toLowerCase().trim();
    const options = Array.from(el.options);
    let match = options.find(o => o.text.toLowerCase().trim() === target);
    if (!match) match = options.find(o => o.value.toLowerCase().trim() === target);
    if (!match) match = options.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
    if (!match) {
      const targetWords = target.split(/\s+/);
      let bestMatch = null, bestScore = 0;
      for (const opt of options) {
        if (opt.value === '' || opt.text.trim() === '') continue;
        const optWords = opt.text.toLowerCase().split(/\s+/);
        const score = targetWords.filter(w => optWords.includes(w)).length;
        if (score > bestScore) { bestScore = score; bestMatch = opt; }
      }
      match = bestMatch;
    }
    if (match) {
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // ─── Auto-fill country / country-code selects from profile ───
  function autoFillCountrySelect(el, userCountry, optionTexts) {
    if (!userCountry) return false;
    const options = Array.from(el.options);
    const country = userCountry.toLowerCase().trim();
    
    // Common country name aliases
    const countryAliases = {
      'india': ['india', 'in'],
      'usa': ['united states', 'us', 'usa', 'u.s.'],
      'united states': ['united states', 'us', 'usa', 'u.s.'],
      'uk': ['united kingdom', 'uk', 'gb', 'great britain'],
      'united kingdom': ['united kingdom', 'uk', 'gb', 'great britain'],
      'uae': ['united arab emirates', 'uae'],
      'united arab emirates': ['united arab emirates', 'uae']
    };
    
    const searchTerms = countryAliases[country] || [country];
    
    // Try exact match first, then partial
    for (const term of searchTerms) {
      // Exact match on country name (before the parenthesis if it has a phone code)
      let match = options.find(o => {
        const txt = o.text.toLowerCase().trim();
        const countryPart = txt.split('(')[0].trim(); // "India (+91)" → "india"
        return countryPart === term;
      });
      if (match) {
        el.value = match.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      
      // Partial match
      match = options.find(o => {
        const txt = o.text.toLowerCase().trim();
        return txt.includes(term) || term.includes(txt.split('(')[0].trim());
      });
      if (match) {
        el.value = match.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function fillCheckbox(el, value) {
    const shouldCheck = ['yes', 'true', '1', 'agree', 'accept', 'on'].includes(value.toLowerCase());
    if (shouldCheck !== el.checked) el.click();
  }

  function fillRadio(el, field, value) {
    const radios = document.querySelectorAll('input[type="radio"][name="' + CSS.escape(field.name) + '"]');
    const target = value.toLowerCase();
    for (const radio of radios) {
      const radioLabel = (
        radio.closest('label')?.textContent?.trim() ||
        document.querySelector('label[for="' + radio.id + '"]')?.textContent?.trim() ||
        radio.value
      ).toLowerCase();
      if (radioLabel.includes(target) || target.includes(radioLabel)) {
        radio.click();
        return;
      }
    }
    if (radios.length > 0) radios[0].click();
  }

  // ─── Auto-submit ───
  // NOTE: Auto-submit is now handled by app.js after ALL fields (profile + AI) are filled.
  // This function is kept as a backup but is no longer auto-called from the injector.

  // ─── Extract job description ───
  function extractJobDescription() {
    const selectors = [
      '[class*="description"]', '[class*="job-desc"]', '[class*="jobDescription"]',
      '[class*="detail"]', '#job-description', '#jobDescription', 'article', '.content', 'main'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 50) {
          return el.textContent.trim().substring(0, 3000);
        }
      } catch(e) {}
    }
    return document.body.textContent.trim().substring(0, 2000);
  }

  // ═══ TURING FORM HANDLER ═══
  function handleTuringForm() {
    const rows = document.querySelectorAll('.job-interest-form__row');
    if (rows.length === 0) {
      result.errors.push('No Turing form rows found.');
      return;
    }

    const processedLabels = new Set();

    rows.forEach((row, idx) => {
      try {
        // Get question heading
        const headingEl = row.querySelector('.job-interest-form__question__heading');
        let label = headingEl ? headingEl.textContent.trim() : '';
        
        // Strip leading question numbers like "1. " or "2. "
        label = label.replace(/^\d+\.\s*/, '').trim();
        
        if (!label || processedLabels.has(label)) return;
        processedLabels.add(label);

        // Detect field types in this row
        const radioGroup = row.querySelector('.ant-radio-group');
        const radioButtonGroup = row.querySelector('.ant-radio-group-solid'); // Rate type toggle
        const checkboxInput = row.querySelector('.ant-checkbox-input');
        const textareaInput = row.querySelector('textarea.ant-input, textarea');
        const selectEl = row.querySelector('.ant-select');
        const radios = row.querySelectorAll('.ant-radio-input');
        const radioButtons = row.querySelectorAll('.ant-radio-button-input'); // Hourly/Monthly buttons

        // === Special case: "Type of Availability" row with confirm checkbox ===
        if (label.toLowerCase().includes('availability') && label.toLowerCase().includes('notice')) {
          // Check the "Yes, I confirm" checkbox
          if (checkboxInput && !checkboxInput.checked) {
            checkboxInput.click();
            // Also click the parent label wrapper for antd
            const wrapper = checkboxInput.closest('.ant-checkbox-wrapper');
            if (wrapper) wrapper.click();
            result.filledCount++;
          }
          return;
        }

        // === Special case: "Confirm your timezone" — already pre-filled, skip ===
        if (label.toLowerCase().includes('confirm your timezone') || 
            label.toLowerCase().includes('timezone')) {
          if (selectEl) {
            result.skippedFields.push({ label, reason: 'Timezone pre-selected' });
            return;
          }
        }

        // === Special case: "Confirm your rate" row ===
        if (label.toLowerCase().includes('confirm your rate') || 
            label.toLowerCase().includes('rate')) {
          // This row has: rate type toggle (Hourly/Monthly) + "Add expected rate" button
          // We can select Hourly by default (already checked in HTML) but the rate
          // needs to be set by clicking the button — mark as unknown for AI
          // Skip this — requires manual rate entry via the "Add your expected rate" button
          result.skippedFields.push({ label, reason: 'Rate requires manual entry via button' });
          return;
        }

        // === Radio buttons (Yes/No questions) ===
        if (radios.length > 0) {
          const options = [];
          radios.forEach(r => {
            const radioWrapper = r.closest('.ant-radio-wrapper');
            const lbl = radioWrapper ? radioWrapper.textContent.trim() : r.value;
            options.push(lbl);
          });

          // Known Turing questions — always answer "Yes"
          const lowerLabel = label.toLowerCase();
          const isAutoYes = 
            lowerLabel.includes('are you interested') ||
            lowerLabel.includes('can you overlap');

          if (isAutoYes) {
            // Click the "Yes" radio option
            let clicked = false;
            radios.forEach((r, i) => {
              if (clicked) return;
              const optLbl = options[i].toLowerCase();
              if (optLbl.includes('yes')) {
                r.click();
                const wrapper = r.closest('.ant-radio-wrapper');
                if (wrapper) wrapper.click();
                clicked = true;
              }
            });
            if (clicked) { result.filledCount++; return; }
          }

          const matchedValue = matchField({ label, name: '' });
          if (matchedValue) {
            // Try to find best matching radio option
            const target = matchedValue.toString().toLowerCase().trim();
            let clicked = false;
            radios.forEach((r, i) => {
              if (clicked) return;
              const optLbl = options[i].toLowerCase();
              if (optLbl.includes(target) || target.includes(optLbl) ||
                  (target.includes('yes') && optLbl.includes('yes')) ||
                  (target.includes('no') && optLbl.includes('no'))) {
                r.click();
                // Also click the label wrapper for antd to register the change
                const wrapper = r.closest('.ant-radio-wrapper');
                if (wrapper) wrapper.click();
                clicked = true;
              }
            });
            if (clicked) result.filledCount++;
            else {
              result.unknownFields.push({
                label, type: 'radio', options,
                selector: buildSelector(radios[0]), name: radios[0].name || '',
                required: true
              });
            }
          } else {
            result.unknownFields.push({
              label, type: 'radio', options,
              selector: buildSelector(radios[0]), name: radios[0].name || '',
              required: true
            });
          }
          return;
        }

        // === Textareas (custom questions) ===
        if (textareaInput) {
          if (!OVERWRITE && textareaInput.value && textareaInput.value.trim() !== '') {
            result.skippedFields.push({ label, reason: 'Already filled' });
            return;
          }
          const matchedValue = matchField({ label, name: textareaInput.name || '' });
          if (matchedValue) {
            safeSetValue(textareaInput, matchedValue.toString());
            result.filledCount++;
          } else {
            result.unknownFields.push({
              label, type: 'textarea', options: [],
              selector: buildSelector(textareaInput), name: textareaInput.name || '',
              required: false
            });
          }
          return;
        }

        // === Checkbox (like "I confirm data is correct") ===
        if (checkboxInput) {
          const checkLabel = row.querySelector('.input-title-name');
          const cLabel = checkLabel ? checkLabel.textContent.trim() : label;
          if (cLabel.toLowerCase().includes('confirm') || cLabel.toLowerCase().includes('agree') ||
              cLabel.toLowerCase().includes('accept') || cLabel.toLowerCase().includes('correct')) {
            if (!checkboxInput.checked) {
              checkboxInput.click();
              const wrapper = checkboxInput.closest('.ant-checkbox-wrapper');
              if (wrapper) wrapper.click();
            }
            result.filledCount++;
          }
          return;
        }

      } catch (err) {
        result.errors.push('Error processing Turing row ' + (idx + 1) + ': ' + err.message);
      }
    });

    result.submittable = true;
  }

  // ═══ WELLFOUND MODAL HANDLER ═══
  function handleWellfoundModal() {
    // Find the application modal — try multiple selectors since the data-test attribute
    // is not always present (the modal wrapper class is styles_modal__XXXXX)
    const modal =
      document.querySelector('[data-test="JobApplication-Modal"]') ||
      document.querySelector('[class*="styles_modal__"]') ||
      document.querySelector('[data-test="JobApplicationModal--SubmitButton"]')?.closest('div.styles_modal__MFCOh, [class*="styles_modal__"]') ||
      document.querySelector('[data-test="JobApplicationModal--SubmitButton"]')?.closest('div[class*="styles_"]');

    if (!modal) {
      result.errors.push('Wellfound: Application modal not found.');
      return;
    }

    // ── Extract job & company info ──
    // Job title is in a specific h4 with class styles_jobTitle
    const jobTitleEl = modal.querySelector('[class*="jobTitle"], [class*="jobTitle__"]');
    const companyEl = modal.querySelector('h3');
    if (jobTitleEl) result.pageTitle = jobTitleEl.textContent.trim();
    else {
      // Fallback: first h4 that is NOT inside the application form area
      const jobInfoEl = modal.querySelector('[class*="jobInfo"] h4');
      if (jobInfoEl) result.pageTitle = jobInfoEl.textContent.trim();
    }
    if (companyEl) result.company = companyEl.textContent.trim();

    // ── Extract skills for AI context ──
    const skillEls = modal.querySelectorAll('[class*="skillPillTags"] span');
    const skills = Array.from(skillEls).map(s => s.textContent.trim()).filter(Boolean);

    const processedSelectors = new Set(); // track by selector to avoid duplicates
    const processedLabels = new Set();    // track by label text

    // Helper: queue a field for AI answering
    function queueForAI(fieldEl, labelText) {
      const sel = buildSelector(fieldEl);
      if (processedSelectors.has(sel)) return;
      processedSelectors.add(sel);
      processedLabels.add(labelText);
      result.unknownFields.push({
        label: labelText,
        type: fieldEl.tagName === 'TEXTAREA' ? 'textarea' : (fieldEl.type || 'text'),
        options: [],
        selector: sel,
        name: fieldEl.name || '',
        required: fieldEl.required || false,
        isWellfound: true
      });
    }

    // Helper: try to fill from profile, else queue for AI
    function processField(fieldEl, labelText) {
      const sel = buildSelector(fieldEl);
      if (processedSelectors.has(sel)) return;
      processedSelectors.add(sel);
      processedLabels.add(labelText);

      const matchedValue = matchField({ label: labelText, name: fieldEl.name || '' });
      if (matchedValue && matchedValue.toString().trim() !== '') {
        wellfoundFill(fieldEl, matchedValue.toString());
        result.filledCount++;
      } else {
        result.unknownFields.push({
          label: labelText,
          type: fieldEl.tagName === 'TEXTAREA' ? 'textarea' : (fieldEl.type || 'text'),
          options: [],
          selector: sel,
          name: fieldEl.name || '',
          required: fieldEl.required || false,
          isWellfound: true
        });
      }
    }

    // ── PASS 1: Scan <label> elements (customQuestionAnswers fields) ──
    const labelBlocks = modal.querySelectorAll('label');
    labelBlocks.forEach((labelBlock, idx) => {
      try {
        let labelText = '';

        // Try specific Wellfound heading class patterns first
        const questionEl = labelBlock.querySelector(
          '[class*="text-dark-aaaa"][class*="font-medium"], [class*="text-dark"][class*="font-medium"], [class*="text-md"][class*="font-medium"]'
        );
        if (questionEl) {
          labelText = questionEl.textContent.trim();
        }

        // Fallback: first inner div's first child div
        if (!labelText) {
          const firstChildDiv = labelBlock.querySelector(':scope > div:first-child > div');
          if (firstChildDiv) labelText = firstChildDiv.textContent.trim();
        }

        // Final fallback: strip form fields from clone
        if (!labelText) {
          const clone = labelBlock.cloneNode(true);
          clone.querySelectorAll('textarea, input, select').forEach(el => el.remove());
          labelText = clone.textContent.trim();
        }

        if (!labelText) return;

        const textarea = labelBlock.querySelector('textarea');
        const input = labelBlock.querySelector('input:not([type="hidden"])');
        const fieldEl = textarea || input;
        if (!fieldEl) return;

        processField(fieldEl, labelText);
      } catch (err) {
        result.errors.push('Wellfound label scan error ' + (idx + 1) + ': ' + err.message);
      }
    });

    // ── PASS 2: Detect the Cover Letter / userNote field (labelled by h4, NOT inside a <label>) ──
    // Structure: <h4>Cover Letter</h4>  →  <div class="styles_userNote__">  →  <textarea name="userNote">
    const userNoteTextarea = modal.querySelector('textarea[name="userNote"], textarea[id*="userNote"]');
    if (userNoteTextarea && !processedSelectors.has(buildSelector(userNoteTextarea))) {
      // Find the label — look for the nearest preceding h4 or h6 sibling/ancestor
      let labelText = 'Cover Letter';
      const container = userNoteTextarea.closest('[class*="userNote"], [class*="note"]');
      if (container) {
        // Walk up until we find a sibling h4/h3/h6
        let parent = container.parentElement;
        for (let i = 0; i < 4 && parent; i++) {
          const heading = parent.querySelector('h4, h3, h6');
          if (heading && heading.textContent.trim().length > 1) {
            labelText = heading.textContent.trim();
            break;
          }
          parent = parent.parentElement;
        }
      }

      // Build a rich prompt from placeholder + company name
      const placeholder = userNoteTextarea.getAttribute('placeholder') || '';
      const companyName = result.company || companyEl?.textContent?.trim() || 'the company';
      const richLabel = labelText +
        (placeholder ? ` (${placeholder.replace(/Write a note to [\w\s]+\.?/i, '').trim() || placeholder})` : '') +
        ` — Write a compelling 2-3 sentence cover letter for ${companyName}.`;

      queueForAI(userNoteTextarea, richLabel.substring(0, 250));
    }

    // ── PASS 3: Catch any remaining textareas/inputs in the application form ──
    // (e.g. future custom questions that are not inside <label> and not userNote)
    const appFormArea = modal.querySelector('[class*="component__0_zKL"], form, [class*="infoHeader"]')?.closest('div') || modal;
    const allTextareas = appFormArea.querySelectorAll('textarea:not([name="userNote"]), input[name*="customQuestion"]');
    allTextareas.forEach((fieldEl, idx) => {
      if (['hidden', 'submit', 'button'].includes(fieldEl.type)) return;
      if (processedSelectors.has(buildSelector(fieldEl))) return;

      // Try to get label from nearest h4, h3, label parent, or placeholder
      let labelText = fieldEl.getAttribute('placeholder') || '';
      const parentLabel = fieldEl.closest('label');
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        clone.querySelectorAll('input, textarea').forEach(e => e.remove());
        labelText = clone.textContent.trim() || labelText;
      }
      if (!labelText) {
        // Walk up looking for a heading
        let p = fieldEl.parentElement;
        for (let i = 0; i < 5 && p; i++) {
          const h = p.querySelector('h4, h3, h5, h6');
          if (h && !h.closest('label') && h.textContent.trim().length > 2) {
            labelText = h.textContent.trim();
            break;
          }
          p = p.parentElement;
        }
      }
      if (!labelText) labelText = fieldEl.name || ('Application field ' + (idx + 1));
      if (processedLabels.has(labelText)) return;

      processField(fieldEl, labelText);
    });

    // ── Include skills in job description for AI context ──
    if (skills.length > 0) {
      result.jobDescription = (result.jobDescription || '') + '\nRequired Skills: ' + skills.join(', ');
    }

    result.submittable = !!modal.querySelector('[data-test="JobApplicationModal--SubmitButton"]');
  }

  // Helper: force-fill a Wellfound field (handles disabled React-controlled inputs)
  function wellfoundFill(el, value) {
    try {
      // Remove disabled attribute so we can interact with it
      el.removeAttribute('disabled');
      el.removeAttribute('readonly');

      // Use React's internal value setter so React state updates
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }

      el.focus();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) {
      el.value = value;
    }
  }

  // ═══ RADIX UI WORK.TURING.COM FORM HANDLER ═══
  function handleWorkTuringForm() {
    // The dialog panel contains all the question cards
    const dialog = document.querySelector('[data-slot="dialog-panel"]');
    if (!dialog) {
      result.errors.push('Work Turing: dialog panel not found.');
      return;
    }

    // Each question is wrapped in a [data-slot="card"]
    const cards = dialog.querySelectorAll('[data-slot="card"]');
    if (cards.length === 0) {
      result.errors.push('Work Turing: no question cards found.');
      return;
    }

    const processedLabels = new Set();

    cards.forEach((card, idx) => {
      try {
        // ── Get question label ──────────────────────────────────────────────
        // Prefer [data-slot="card-title"] (cards 1-6); fall back to first <label>
        // (cards 7-15 use <label data-slot="label"> wrapping the textarea).
        const titleEl = card.querySelector('[data-slot="card-title"]') ||
                        card.querySelector('label[data-slot="label"]') ||
                        card.querySelector('label');
        if (!titleEl) return;

        // Clone so we can strip inline asterisk spans without mutating the page
        const cloneTitle = titleEl.cloneNode(true);
        cloneTitle.querySelectorAll('.text-destructive, [aria-hidden="true"]').forEach(n => n.remove());
        let label = cloneTitle.textContent.trim().replace(/\s+/g, ' ').replace(/\*+$/, '').trim();
        if (!label || processedLabels.has(label)) return;
        processedLabels.add(label);

        const isRequired = !!card.querySelector('.text-destructive, [aria-required="true"]');

        // ── Radix Radio Group ────────────────────────────────────────────────
        // <button role="radio" data-slot="radio-group-item">
        // Radios are ALWAYS the only interactive widget in their card.
        const radioButtons = card.querySelectorAll('button[role="radio"][data-slot="radio-group-item"]');
        if (radioButtons.length > 0) {
          const options = Array.from(radioButtons).map(btn => {
            let lblText = '';
            const btnId = btn.id;
            if (btnId) {
              try {
                const lbl = card.querySelector('label[for="' + CSS.escape(btnId) + '"]');
                if (lbl) lblText = lbl.textContent.trim();
              } catch(e) {}
            }
            if (!lblText) {
              let sib = btn.nextElementSibling;
              while (sib) {
                if (sib.tagName === 'LABEL') { lblText = sib.textContent.trim(); break; }
                sib = sib.nextElementSibling;
              }
            }
            if (!lblText) lblText = btn.getAttribute('value') || btn.textContent.trim();
            return { text: lblText, value: btn.getAttribute('value') || lblText, element: btn };
          });

          const lowerLabel = label.toLowerCase();
          // Auto-answer known yes/no questions
          const isAutoYes = lowerLabel.includes('are you interested') ||
                            lowerLabel.includes('can you overlap');
          if (isAutoYes) {
            const yesOpt = options.find(o =>
              o.text.toLowerCase().includes('yes') || o.value.toLowerCase() === 'yes'
            ) || options[0];
            if (yesOpt) {
              yesOpt.element.scrollIntoView({ behavior: 'instant', block: 'center' });
              yesOpt.element.click();
              result.filledCount++;
            }
            return; // radios are exclusive in their card
          }

          const matchedValue = matchField({ label, name: '' });
          if (matchedValue) {
            const mv = matchedValue.toString().toLowerCase().trim();
            const match = options.find(o =>
              o.text.toLowerCase() === mv ||
              o.text.toLowerCase().includes(mv) ||
              mv.includes(o.text.toLowerCase()) ||
              o.value.toLowerCase() === mv
            ) || options[0];
            if (match) {
              match.element.scrollIntoView({ behavior: 'instant', block: 'center' });
              match.element.click();
              result.filledCount++;
            }
          } else {
            result.unknownFields.push({
              label, type: 'radix-radio',
              options: options.map(o => o.text),
              optionValues: options.map(o => o.value),
              selector: '', name: '',
              required: isRequired,
              isWorkTuring: true, cardIndex: idx
            });
          }
          return; // radios are always exclusive
        }

        // ── Textarea / Text Input ────────────────────────────────────────────
        // Process text widget FIRST so mixed cards (e.g. URL input + checkbox)
        // have the input captured before the checkbox scan.
        const textarea = card.querySelector('textarea[data-slot="textarea"], textarea');
        const textInput = !textarea && card.querySelector(
          'input[type="text"], input[type="url"], input[type="email"]'
        );
        const mainWidget = textarea || textInput;

        if (mainWidget) {
          const widgetType = mainWidget.tagName === 'TEXTAREA' ? 'textarea' : (mainWidget.type || 'text');
          if (!OVERWRITE && mainWidget.value && mainWidget.value.trim() !== '') {
            result.skippedFields.push({ label, reason: 'Already filled' });
          } else {
            const matchedValue = matchField({ label, name: mainWidget.name || '' });
            if (matchedValue && matchedValue.toString().trim()) {
              safeSetValue(mainWidget, matchedValue.toString());
              result.filledCount++;
            } else {
              result.unknownFields.push({
                label, type: widgetType, options: [],
                selector: mainWidget.id ? '#' + CSS.escape(mainWidget.id) : '',
                name: mainWidget.name || '',
                required: isRequired,
                isWorkTuring: true, cardIndex: idx
              });
            }
          }
        }

        // ── Radix Checkboxes ─────────────────────────────────────────────────
        // ALWAYS scanned even when mainWidget was found (mixed cards like card 2).
        // <button role="checkbox" data-slot="checkbox">
        const checkboxButtons = card.querySelectorAll('button[role="checkbox"][data-slot="checkbox"]');
        checkboxButtons.forEach(btn => {
          const alreadyChecked = btn.getAttribute('aria-checked') === 'true' ||
                                 btn.getAttribute('data-state') === 'checked';
          if (alreadyChecked) return;

          let cbLabel = '';
          const btnId = btn.id;
          if (btnId) {
            try {
              const lbl = card.querySelector('label[for="' + CSS.escape(btnId) + '"]');
              if (lbl) cbLabel = lbl.textContent.trim();
            } catch(e) {}
          }
          if (!cbLabel) cbLabel = label;

          const cbLower = (cbLabel + ' ' + label).toLowerCase();

          // Guard: never auto-check "I don't have..." type disclaimers
          const isDisavowal = /don[`']?t have|do not have|i don[`']?t|i do not/.test(cbLower);

          // Auto-check consent / confirmation boxes (unless disavowal)
          const isConsent = !isDisavowal && [
            'confirm', 'agree', 'accept', 'correct', 'acknowledge',
            'terms', 'privacy', 'data', 'availability'
          ].some(p => cbLower.includes(p));

          if (isConsent) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            btn.click();
            result.filledCount++;
          } else if (!isDisavowal) {
            // Unknown non-consent, non-disavowal → ask AI
            result.unknownFields.push({
              label: cbLabel || label,
              type: 'radix-checkbox',
              options: ['Yes', 'No'],
              selector: '', name: '',
              required: isRequired,
              isWorkTuring: true, cardIndex: idx
            });
          }
          // isDisavowal → intentionally left unchecked
        });

        // If nothing at all was handled, and there were no radios/textareas/inputs/
        // checkboxes — skip silently (e.g. the timezone or rate cards).

      } catch (err) {
        result.errors.push('Work Turing card ' + (idx + 1) + ': ' + err.message);
      }
    });


    result.submittable = !!dialog.querySelector('button[type="submit"]');
  }

  // ═══ MAIN EXECUTION ═══
  if (isGoogleForm) {
    handleGoogleForm();
  } else if (isWorkTuringForm) {
    handleWorkTuringForm();
  } else if (isTuringForm) {
    handleTuringForm();
  } else if (isWellfound) {
    handleWellfoundModal();
  } else {
    handleStandardForm();
  }

  result.jobDescription = extractJobDescription();
  result.totalFields = result.filledCount + result.skippedFields.length + result.unknownFields.length;

  // Auto-submit is now handled by app.js after ALL fields (profile + AI) are filled.
  // We just flag that the form is submittable.
  result.autoSubmitted = false;

  return JSON.stringify(result);

})(FIELD_MAP_PLACEHOLDER, USER_PROFILE_PLACEHOLDER, OPTIONS_PLACEHOLDER);
