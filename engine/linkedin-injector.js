// ══════════════════════════════════════════════════════════
// MassApply — LinkedIn Easy Apply Injector (v2)
// Runs inside webview context on LinkedIn pages
// Fixed: Real LinkedIn DOM selectors, plain-text job desc,
//        review loop protection, improved AI integration
// ══════════════════════════════════════════════════════════

(function(FIELD_MAP, USER_PROFILE, OPTIONS) {
  'use strict';

  const ACTION = OPTIONS.action || 'scanJobs';
  const JOB_INDEX = OPTIONS.jobIndex || 0;
  const AI_ANSWERS = OPTIONS.aiAnswers || [];

  const result = {
    action: ACTION,
    success: false,
    data: null,
    error: null
  };

  // ═══ HELPER: Safely set value with React-compatible events ═══
  function safeSetValue(el, value) {
    el.focus();
    try {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    } catch(e) { el.value = value; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ═══ HELPER: Click with full event sequence ═══
  function realClick(el) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
    el.dispatchEvent(new MouseEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    el.click();
  }

  // ═══ HELPER: Extract clean plain text from an element (strip HTML) ═══
  function plainText(el) {
    if (!el) return '';
    // Clone to avoid mutating the page, strip scripts/styles
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, svg, img, button, [role="img"]').forEach(n => n.remove());
    // Convert <br>, <p>, <div> to newlines for readability
    let html = clone.innerHTML || '';
    html = html.replace(/<br\s*\/?>/gi, '\n');
    html = html.replace(/<\/(p|div|li|h[1-6])>/gi, '\n');
    html = html.replace(/<[^>]+>/g, ' ');
    // Decode HTML entities
    const txt = document.createElement('textarea');
    txt.innerHTML = html;
    return txt.value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ═══ HELPER: Get text label from LinkedIn form group ═══
  function getGroupLabel(group) {
    const labelSelectors = [
      'label',
      '.fb-dash-form-element__label',
      '.artdeco-text-input--label',
      '[data-test-form-element-label]',
      '.t-14.t-bold',
      '.jobs-easy-apply-form-element__label',
      'span.t-bold',
      '.t-16.t-bold'
    ];

    for (const sel of labelSelectors) {
      const lbl = group.querySelector(sel);
      if (lbl && lbl.textContent.trim()) {
        return lbl.textContent.trim().replace(/\s+/g, ' ');
      }
    }
    
    const input = group.querySelector('input, select, textarea');
    if (input) {
      return input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.name || '';
    }
    return '';
  }

  // ═══ HELPER: Check if field is required ═══
  function isRequired(group) {
    const requiredIndicator = group.querySelector('.artdeco-text-input--required, [required], .required, .fb-dash-form-element__error-field');
    const label = group.querySelector('label, .fb-dash-form-element__label');
    if (label && label.textContent.includes('*')) return true;
    if (requiredIndicator) return true;
    const input = group.querySelector('input, select, textarea');
    return input?.required || input?.getAttribute('aria-required') === 'true';
  }

  // ═══ HELPER: Match field label to profile data ═══
  function matchToProfile(label) {
    if (!label) return null;
    const l = label.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

    const mapping = {
      'first name': USER_PROFILE.firstName || (USER_PROFILE.fullName || '').split(' ')[0],
      'last name': USER_PROFILE.lastName || (USER_PROFILE.fullName || '').split(' ').slice(1).join(' '),
      'full name': USER_PROFILE.fullName || `${USER_PROFILE.firstName || ''} ${USER_PROFILE.lastName || ''}`.trim(),
      'email': USER_PROFILE.email,
      'email address': USER_PROFILE.email,
      'phone': USER_PROFILE.phone,
      'phone number': USER_PROFILE.phone,
      'mobile': USER_PROFILE.phone,
      'mobile number': USER_PROFILE.phone,
      'city': USER_PROFILE.city,
      'current city': USER_PROFILE.city,
      'location': USER_PROFILE.city,
      'current location': USER_PROFILE.city,
      'state': USER_PROFILE.state,
      'country': USER_PROFILE.country,
      'zip': USER_PROFILE.pincode,
      'zip code': USER_PROFILE.pincode,
      'postal code': USER_PROFILE.pincode,
      'pincode': USER_PROFILE.pincode,
      'address': USER_PROFILE.address,
      'street address': USER_PROFILE.address,
      'linkedin': USER_PROFILE.linkedinUrl,
      'linkedin url': USER_PROFILE.linkedinUrl,
      'linkedin profile': USER_PROFILE.linkedinUrl,
      'github': USER_PROFILE.githubUrl,
      'github url': USER_PROFILE.githubUrl,
      'portfolio': USER_PROFILE.portfolioUrl,
      'portfolio url': USER_PROFILE.portfolioUrl,
      'website': USER_PROFILE.portfolioUrl,
      'personal website': USER_PROFILE.portfolioUrl,
      'college': USER_PROFILE.collegeName,
      'university': USER_PROFILE.university || USER_PROFILE.collegeName,
      'degree': USER_PROFILE.degree,
      'gpa': USER_PROFILE.cgpa,
      'cgpa': USER_PROFILE.cgpa,
      'graduation year': USER_PROFILE.graduationYear,
      'year of graduation': USER_PROFILE.graduationYear,
      'experience': USER_PROFILE.experience,
      'years of experience': USER_PROFILE.experience,
      'total experience': USER_PROFILE.experience,
      'current company': USER_PROFILE.currentCompany,
      'current employer': USER_PROFILE.currentCompany,
      'current role': USER_PROFILE.currentDesignation,
      'current title': USER_PROFILE.currentDesignation,
      'designation': USER_PROFILE.currentDesignation,
      'job title': USER_PROFILE.currentDesignation,
      'skills': USER_PROFILE.skills,
      'salary': USER_PROFILE.expectedCTC,
      'expected salary': USER_PROFILE.expectedCTC,
      'expected ctc': USER_PROFILE.expectedCTC,
      'desired salary': USER_PROFILE.expectedCTC,
      'compensation': USER_PROFILE.expectedCTC,
      'expected compensation': USER_PROFILE.expectedCTC,
      'expected comp': USER_PROFILE.expectedCTC,
      'current salary': USER_PROFILE.currentCTC,
      'current ctc': USER_PROFILE.currentCTC,
      'notice period': USER_PROFILE.noticePeriod,
      'cover letter': USER_PROFILE.coverLetter,
      'summary': USER_PROFILE.aboutMe,
      'about': USER_PROFILE.aboutMe,
      'headline': USER_PROFILE.currentDesignation,
    };

    if (mapping[l] !== undefined && mapping[l]) return mapping[l];

    const sortedMapping = Object.entries(mapping).sort((a, b) => b[0].length - a[0].length);
    for (const [key, val] of sortedMapping) {
      if (val && (l.includes(key) || key.includes(l))) return val;
    }

    if (FIELD_MAP) {
      const sortedFieldMap = Object.entries(FIELD_MAP).sort((a, b) => b[0].length - a[0].length);
      for (const [pattern, profileKey] of sortedFieldMap) {
        if (l.includes(pattern.toLowerCase())) {
          return USER_PROFILE[profileKey] || null;
        }
      }
    }

    // Check custom Q&A from profile
    if (USER_PROFILE.customQA && Array.isArray(USER_PROFILE.customQA)) {
      for (const qa of USER_PROFILE.customQA) {
        if (!qa.question || !qa.answer) continue;
        const qLower = qa.question.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        if (l.includes(qLower) || qLower.includes(l) || l === qLower) {
          return qa.answer;
        }
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════
  // ACTION: scanJobs — Find all job cards on search page
  // Uses REAL LinkedIn selectors from 2025 DOM
  // ═══════════════════════════════════════════════════
  if (ACTION === 'scanJobs') {
    const jobs = [];

    // Primary: use data-job-id wrapper for stable identification
    const cardSelectors = [
      'div.job-card-job-posting-card-wrapper[data-job-id]',
      '.job-card-container[data-job-id]',
      '[data-occludable-job-id]',
      'li.ember-view.occludable-update'
    ];

    let cards = [];
    let usedSelector = '';
    for (const sel of cardSelectors) {
      cards = document.querySelectorAll(sel);
      if (cards.length > 0) { usedSelector = sel; break; }
    }

    cards.forEach((card, idx) => {
      // Get the stable job ID from data attribute
      const jobId = card.getAttribute('data-job-id') || card.getAttribute('data-occludable-job-id') || '';

      // Title: inside artdeco-entity-lockup__title
      const titleEl = card.querySelector(
        '.job-card-job-posting-card-wrapper__title span[aria-hidden="true"] strong, ' +
        '.artdeco-entity-lockup__title span[aria-hidden="true"] strong, ' +
        '.artdeco-entity-lockup__title span[aria-hidden="true"], ' +
        '.artdeco-entity-lockup__title a, ' +
        '.job-card-list__title, ' +
        'a.job-card-container__link'
      );

      // Company: inside artdeco-entity-lockup__subtitle
      const companyEl = card.querySelector(
        '.artdeco-entity-lockup__subtitle div, ' +
        '.artdeco-entity-lockup__subtitle, ' +
        '.job-card-container__primary-description, ' +
        '.job-card-container__company-name'
      );

      // Location: inside artdeco-entity-lockup__caption
      const locationEl = card.querySelector(
        '.artdeco-entity-lockup__caption div, ' +
        '.artdeco-entity-lockup__caption, ' +
        '.job-card-container__metadata-item'
      );

      const title = titleEl?.textContent?.trim() || `Job ${idx + 1}`;
      const company = companyEl?.textContent?.trim() || '';
      const location = locationEl?.textContent?.trim() || '';

      // Check footer for "Applied" text
      const footerItems = card.querySelectorAll('.job-card-job-posting-card-wrapper__footer-item');
      let isApplied = false;
      footerItems.forEach(fi => {
        const txt = fi.textContent.trim().toLowerCase();
        if (txt === 'applied') isApplied = true;
      });
      // Also check other applied indicators
      if (!isApplied) {
        const appliedBadge = card.querySelector('.job-card-container__footer-item--applied, .artdeco-inline-feedback--success');
        isApplied = !!appliedBadge;
      }

      // Check if Easy Apply
      let isEasyApply = false;
      footerItems.forEach(fi => {
        if (fi.textContent.trim().toLowerCase().includes('easy apply')) isEasyApply = true;
      });

      jobs.push({ index: idx, jobId, title, company, location, isApplied, isEasyApply });
    });

    result.success = true;
    result.data = { jobs, totalCards: cards.length, selector: usedSelector };
  }

  // ═══════════════════════════════════════════════════
  // ACTION: clickJob — Click a specific job card
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'clickJob') {
    const JOB_ID = OPTIONS.jobId || '';

    // Primary: find the card by data-job-id for reliable targeting
    let card = null;
    if (JOB_ID) {
      card = document.querySelector(`div.job-card-job-posting-card-wrapper[data-job-id="${JOB_ID}"]`);
      if (!card) card = document.querySelector(`[data-occludable-job-id="${JOB_ID}"]`);
    }

    // Fallback: find by index
    if (!card) {
      const fallbackSelectors = [
        'div.job-card-job-posting-card-wrapper[data-job-id]',
        '.job-card-container[data-job-id]',
        '[data-occludable-job-id]',
        'li.ember-view.occludable-update'
      ];
      let cards = [];
      for (const sel of fallbackSelectors) {
        cards = document.querySelectorAll(sel);
        if (cards.length > 0) break;
      }
      card = cards[JOB_INDEX];
    }

    if (card) {
      // Click the <a> card link directly — the actual clickable element
      const clickTarget = card.querySelector(
        'a.job-card-job-posting-card-wrapper__card-link, ' +
        'a[data-test-app-aware-link], ' +
        '.job-card-job-posting-card-wrapper__title span[aria-hidden="true"], ' +
        '.artdeco-entity-lockup__title a, ' +
        'a.job-card-container__link'
      ) || card;

      realClick(clickTarget);
      result.success = true;
      result.data = { clicked: JOB_INDEX, jobId: JOB_ID };
    } else {
      result.success = false;
      result.error = `Job card not found (jobId: ${JOB_ID}, index: ${JOB_INDEX})`;
    }
  }

  // ═══════════════════════════════════════════════════
  // ACTION: clickEasyApply — Find and click the Easy Apply button
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'clickEasyApply') {
    // Try the exact button from the real DOM first
    let btn = document.querySelector('#jobs-apply-button-id');
    let isEasyApply = btn ? btn.textContent.trim().toLowerCase().includes('easy apply') : false;

    // Fallback selectors
    if (!btn || !isEasyApply) {
      const easyApplySelectors = [
        '.jobs-apply-button--top-card button.jobs-apply-button',
        'button.jobs-apply-button',
        '.jobs-apply-button--top-card .artdeco-button--primary',
        '.jobs-s-apply button',
        'button.jobs-apply-button.artdeco-button--primary',
      ];

      for (const sel of easyApplySelectors) {
        const candidates = document.querySelectorAll(sel);
        for (const candidate of candidates) {
          const text = candidate.textContent.trim().toLowerCase();
          const ariaLabel = (candidate.getAttribute('aria-label') || '').toLowerCase();
          if (text.includes('easy apply') || ariaLabel.includes('easy apply')) {
            btn = candidate;
            isEasyApply = true;
            break;
          }
        }
        if (btn && isEasyApply) break;
      }
    }

    // Final fallback: any visible button with "Easy Apply" text
    if (!btn || !isEasyApply) {
      const allBtns = document.querySelectorAll('button');
      for (const b of allBtns) {
        if (b.textContent.trim().toLowerCase().includes('easy apply') && b.offsetParent !== null) {
          btn = b;
          isEasyApply = true;
          break;
        }
      }
    }

    if (btn && isEasyApply) {
      realClick(btn);
      result.success = true;
      result.data = { isEasyApply: true };
    } else {
      const appliedEl = document.querySelector('.jobs-apply-button--applied, .artdeco-inline-feedback--success');
      const applyBtnText = document.querySelector('.jobs-apply-button')?.textContent || '';
      if (appliedEl || applyBtnText.includes('Applied')) {
        result.success = false;
        result.error = 'ALREADY_APPLIED';
      } else if (document.querySelector('button.jobs-apply-button') && !applyBtnText.toLowerCase().includes('easy apply')) {
        result.success = false;
        result.error = 'EXTERNAL_APPLY';
      } else {
        result.success = false;
        result.error = 'NO_EASY_APPLY_BUTTON';
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // ACTION: fillStep — Scan & fill current modal step
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'fillStep') {
    const modal = document.querySelector('.jobs-easy-apply-modal, .artdeco-modal--layer-default, [role="dialog"][aria-labelledby*="easy-apply"]');
    
    if (!modal) {
      result.success = false;
      result.error = 'NO_MODAL_FOUND';
      return JSON.stringify(result);
    }

    // Determine current step info
    const progressBar = modal.querySelector('.artdeco-completeness-meter-linear__progress-element, progress');
    const progressValue = progressBar?.getAttribute('value') || progressBar?.style?.width || '0';
    
    const stepIndicator = modal.querySelector('.artdeco-completeness-meter-linear, .jobs-easy-apply-content header');
    const stepText = stepIndicator?.textContent?.trim() || '';

    // Scan all form groups in the modal
    const formGroups = modal.querySelectorAll(
      '.jobs-easy-apply-form-section__grouping, ' +
      '.fb-dash-form-element, ' +
      '.jobs-easy-apply-form-element, ' +
      '.artdeco-text-input, ' +
      '.jobs-easy-apply-form-section__grouping .ember-view'
    );

    const filledFields = [];
    const unknownFields = [];
    const skippedFields = [];
    let hasFileUpload = false;
    const fileUploadSelectors = [];

    formGroups.forEach(group => {
      let label = getGroupLabel(group);
      if (!label) return;

      const errorMsg = group.querySelector('.artdeco-inline-feedback--error, .fb-dash-form-element__error, [id*="-error"]');
      if (errorMsg && errorMsg.textContent) {
        label = label + " (Constraint/Error: " + errorMsg.textContent.trim() + ")";
      }

      const numInput = group.querySelector('input[type="number"]');
      if (numInput) {
        const min = numInput.getAttribute('min');
        const step = numInput.getAttribute('step');
        if (step && step.includes('.')) {
          label += ' (Constraint/Error: Enter a decimal number)';
        } else if (min !== null) {
          label += ' (Constraint/Error: Enter a whole number)';
        }
      }

      const required = isRequired(group);

      // Check for file upload
      const fileInput = group.querySelector('input[type="file"]');
      if (fileInput) {
        hasFileUpload = true;
        fileUploadSelectors.push({
          label,
          selector: fileInput.id ? `#${fileInput.id}` : 'input[type="file"]',
          accept: fileInput.getAttribute('accept') || ''
        });
        return;
      }

      // Text inputs
      const textInput = group.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], input:not([type]):not([role])');
      if (textInput && textInput.type !== 'hidden' && textInput.type !== 'file') {
        const currentVal = textInput.value.trim();
        const profileVal = matchToProfile(label);
        
        if (profileVal && (!currentVal || OPTIONS.overwrite)) {
          safeSetValue(textInput, String(profileVal));
          filledFields.push({ label, value: String(profileVal), source: 'profile' });
        } else if (!currentVal) {
          const aiAnswer = AI_ANSWERS.find(a => a.label === label || label.toLowerCase().includes(a.label.toLowerCase()) || a.label.toLowerCase().includes(label.toLowerCase()));
          if (aiAnswer && aiAnswer.answer) {
            safeSetValue(textInput, aiAnswer.answer);
            filledFields.push({ label, value: aiAnswer.answer, source: 'ai' });
          } else {
            unknownFields.push({ label, type: 'text', required, selector: textInput.id ? `#${textInput.id}` : '' });
          }
        } else {
          skippedFields.push({ label, reason: 'already filled', value: currentVal });
        }
        return;
      }

      // Textarea
      const textarea = group.querySelector('textarea');
      if (textarea) {
        const currentVal = textarea.value.trim();
        const profileVal = matchToProfile(label);
        
        if (profileVal && (!currentVal || OPTIONS.overwrite)) {
          safeSetValue(textarea, String(profileVal));
          filledFields.push({ label, value: String(profileVal), source: 'profile' });
        } else if (!currentVal) {
          const aiAnswer = AI_ANSWERS.find(a => a.label === label || label.toLowerCase().includes(a.label.toLowerCase()) || a.label.toLowerCase().includes(label.toLowerCase()));
          if (aiAnswer && aiAnswer.answer) {
            safeSetValue(textarea, aiAnswer.answer);
            filledFields.push({ label, value: aiAnswer.answer, source: 'ai' });
          } else {
            unknownFields.push({ label, type: 'textarea', required, selector: textarea.id ? `#${textarea.id}` : '' });
          }
        } else {
          skippedFields.push({ label, reason: 'already filled', value: currentVal });
        }
        return;
      }

      // Select dropdown
      const selectEl = group.querySelector('select');
      if (selectEl) {
        const currentVal = selectEl.value;
        const profileVal = matchToProfile(label);
        const options = Array.from(selectEl.options).map(o => ({ text: o.text.trim(), value: o.value })).filter(o => o.value);
        const cappedOptions = options.length > 20 
          ? [...options.map(o => o.text).slice(0, 5), '...(' + options.length + ' total options)'] 
          : options.map(o => o.text);

        if (profileVal && (!currentVal || OPTIONS.overwrite)) {
          const target = String(profileVal).toLowerCase();
          const match = options.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()))
                     || options.find(o => o.value.toLowerCase().includes(target));
          if (match) {
            selectEl.value = match.value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            filledFields.push({ label, value: match.text, source: 'profile' });
          } else {
            unknownFields.push({ label, type: 'select', required, options: cappedOptions, selector: selectEl.id ? `#${selectEl.id}` : '' });
          }
        } else if (!currentVal || currentVal === '' || currentVal === 'Select an option' || currentVal === 'Select') {
          const aiAnswer = AI_ANSWERS.find(a => a.label === label || label.toLowerCase().includes(a.label.toLowerCase()));
          if (aiAnswer && aiAnswer.answer) {
            const target = aiAnswer.answer.toLowerCase();
            const match = options.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
            if (match) {
              selectEl.value = match.value;
              selectEl.dispatchEvent(new Event('change', { bubbles: true }));
              filledFields.push({ label, value: match.text, source: 'ai' });
            }
          } else {
            unknownFields.push({ label, type: 'select', required, options: cappedOptions, selector: selectEl.id ? `#${selectEl.id}` : '' });
          }
        } else {
          skippedFields.push({ label, reason: 'already selected' });
        }
        return;
      }

      // Radio buttons
      const radios = group.querySelectorAll('input[type="radio"]');
      if (radios.length > 0) {
        const isChecked = Array.from(radios).some(r => r.checked);
        const radioOptions = Array.from(radios).map(r => {
          const lbl = r.closest('label')?.textContent?.trim() || r.parentElement?.textContent?.trim() || r.value;
          return { text: lbl, value: r.value, element: r };
        });

        if (!isChecked || OPTIONS.overwrite) {
          const profileVal = matchToProfile(label);
          if (profileVal) {
            const target = String(profileVal).toLowerCase();
            const match = radioOptions.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
            if (match) {
              realClick(match.element);
              filledFields.push({ label, value: match.text, source: 'profile' });
            } else {
              unknownFields.push({ label, type: 'radio', required, options: radioOptions.map(o => o.text) });
            }
          } else {
            const aiAnswer = AI_ANSWERS.find(a => a.label === label || label.toLowerCase().includes(a.label.toLowerCase()));
            if (aiAnswer && aiAnswer.answer) {
              const target = aiAnswer.answer.toLowerCase();
              const match = radioOptions.find(o => o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase()));
              if (match) {
                realClick(match.element);
                filledFields.push({ label, value: match.text, source: 'ai' });
              } else if (radioOptions[0]) {
                realClick(radioOptions[0].element);
                filledFields.push({ label, value: radioOptions[0].text, source: 'ai-fallback' });
              }
            } else {
              unknownFields.push({ label, type: 'radio', required, options: radioOptions.map(o => o.text) });
            }
          }
        } else {
          skippedFields.push({ label, reason: 'already selected' });
        }
        return;
      }

      // Checkbox
      const checkboxes = group.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length > 0) {
        checkboxes.forEach(cb => {
          if (!cb.checked) {
            const cbLabel = cb.closest('label')?.textContent?.toLowerCase() || label.toLowerCase();
            if (cbLabel.includes('agree') || cbLabel.includes('consent') || cbLabel.includes('confirm') || cbLabel.includes('follow') || required) {
              realClick(cb);
              filledFields.push({ label: cbLabel, value: 'checked', source: 'auto' });
            }
          }
        });
        return;
      }

      // LinkedIn typeahead / combobox
      const typeahead = group.querySelector('[role="combobox"], .artdeco-typeahead-input, .basic-typeahead');
      if (typeahead) {
        const input = typeahead.querySelector('input') || typeahead;
        const currentVal = input.value?.trim();
        const profileVal = matchToProfile(label);

        if (profileVal && (!currentVal || OPTIONS.overwrite)) {
          safeSetValue(input, String(profileVal));
          filledFields.push({ label, value: String(profileVal), source: 'profile', needsTypeaheadSelect: true });
        } else if (!currentVal) {
          unknownFields.push({ label, type: 'typeahead', required, selector: '' });
        }
        return;
      }
    });

    // Determine what buttons are available in the modal footer
    const footer = modal.querySelector('.jobs-easy-apply-modal__footer, .artdeco-modal__actionbar, footer');
    const buttons = {};
    
    if (footer) {
      const footerBtns = footer.querySelectorAll('button');
      footerBtns.forEach(btn => {
        const text = btn.textContent.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        
        if (text.includes('next') || ariaLabel.includes('next step') || ariaLabel.includes('continue')) buttons.next = true;
        if (text.includes('review') || ariaLabel.includes('review')) buttons.review = true;
        if (text.includes('submit') || ariaLabel.includes('submit application')) buttons.submit = true;
        if (text.includes('back') || ariaLabel.includes('back') || ariaLabel.includes('previous')) buttons.back = true;
      });
    }

    result.success = true;
    result.data = {
      progress: progressValue,
      stepText,
      filledFields,
      unknownFields,
      skippedFields,
      hasFileUpload,
      fileUploadSelectors,
      buttons,
      totalFormGroups: formGroups.length
    };
  }

  // ═══════════════════════════════════════════════════
  // ACTION: nextStep — Click Next / Review / Submit
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'nextStep') {
    // Check for "Continue applying" safety modal first
    const safetyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase() === 'continue applying');
    if (safetyBtn) {
      realClick(safetyBtn);
      result.success = true;
      result.data = { clicked: 'continue_applying_safety_modal' };
      return JSON.stringify(result);
    }

    const modal = document.querySelector('.jobs-easy-apply-modal, .artdeco-modal--layer-default, [role="dialog"]');
    if (!modal) {
      result.success = false;
      result.error = 'NO_MODAL_FOUND';
      return JSON.stringify(result);
    }

    const footer = modal.querySelector('.jobs-easy-apply-modal__footer, .artdeco-modal__actionbar, footer');
    if (!footer) {
      result.success = false;
      result.error = 'NO_FOOTER_FOUND';
      return JSON.stringify(result);
    }

    const footerBtns = footer.querySelectorAll('button');
    let clicked = null;

    // Priority: Submit > Review > Next
    for (const btn of footerBtns) {
      const text = btn.textContent.trim().toLowerCase();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('submit') || ariaLabel.includes('submit application')) {
        realClick(btn);
        clicked = 'submit';
        break;
      }
    }

    if (!clicked) {
      for (const btn of footerBtns) {
        const text = btn.textContent.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('review') || ariaLabel.includes('review')) {
          realClick(btn);
          clicked = 'review';
          break;
        }
      }
    }

    if (!clicked) {
      for (const btn of footerBtns) {
        const text = btn.textContent.trim().toLowerCase();
        const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes('next') || ariaLabel.includes('next') || ariaLabel.includes('continue')) {
          realClick(btn);
          clicked = 'next';
          break;
        }
      }
    }

    if (clicked) {
      result.success = true;
      result.data = { clicked };
    } else {
      result.success = false;
      result.error = 'NO_NAVIGATION_BUTTON';
    }
  }

  // ═══════════════════════════════════════════════════
  // ACTION: submitApp — Specifically click Submit
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'submitApp') {
    const modal = document.querySelector('.jobs-easy-apply-modal, .artdeco-modal--layer-default, [role="dialog"]');
    if (!modal) {
      result.success = false;
      result.error = 'NO_MODAL_FOUND';
      return JSON.stringify(result);
    }

    const submitSelectors = [
      'button[aria-label="Submit application"]',
      'button[aria-label="Submit"]',
      'footer button.artdeco-button--primary'
    ];

    let submitBtn = null;
    for (const sel of submitSelectors) {
      submitBtn = modal.querySelector(sel);
      if (submitBtn) break;
    }

    if (!submitBtn) {
      const allBtns = modal.querySelectorAll('button');
      for (const btn of allBtns) {
        if (btn.textContent.trim().toLowerCase().includes('submit')) {
          submitBtn = btn;
          break;
        }
      }
    }

    if (submitBtn) {
      realClick(submitBtn);
      result.success = true;
      result.data = { submitted: true };
    } else {
      result.success = false;
      result.error = 'NO_SUBMIT_BUTTON';
    }
  }

  // ═══════════════════════════════════════════════════
  // ACTION: dismissModal — Close the Easy Apply modal
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'dismissModal') {
    const dismissSelectors = [
      'button[aria-label="Dismiss"]',
      '.artdeco-modal__dismiss',
      '.jobs-easy-apply-modal__close-button',
      'button[data-test-modal-close-btn]'
    ];

    let dismissed = false;
    for (const sel of dismissSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        realClick(btn);
        dismissed = true;
        break;
      }
    }

    if (dismissed) {
      setTimeout(() => {
        const discardBtn = document.querySelector('button[data-test-dialog-primary-btn], button[data-control-name="discard_application_confirm_btn"]');
        if (discardBtn) {
          realClick(discardBtn);
        } else {
          const allBtns = document.querySelectorAll('button');
          for (const b of allBtns) {
            if (b.textContent.trim().toLowerCase() === 'discard' || b.textContent.trim().toLowerCase().includes('discard')) {
              realClick(b);
              break;
            }
          }
        }
      }, 500);
      result.success = true;
      result.data = { dismissed: true };
    } else {
      result.success = false;
      result.error = 'NO_DISMISS_BUTTON';
    }
  }

  // ═══════════════════════════════════════════════════
  // ACTION: checkStatus — Check if application was submitted
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'checkStatus') {
    const modal = document.querySelector('.jobs-easy-apply-modal, .artdeco-modal--layer-default');
    const successMsg = document.querySelector('.artdeco-inline-feedback--success, .artdeco-toast-item--visible');
    const successText = document.body.textContent.includes('Your application was sent') || 
                        document.body.textContent.includes('Application submitted') ||
                        document.body.textContent.includes('application was submitted');

    const applyBtn = document.querySelector('.jobs-apply-button');
    const showsApplied = applyBtn?.textContent?.includes('Applied');

    if (successMsg || successText || showsApplied || !modal) {
      result.success = true;
      result.data = { 
        applicationSent: true,
        hasSuccessMessage: !!successMsg || successText,
        showsApplied: !!showsApplied,
        modalDismissed: !modal
      };
    } else {
      const errorMsgs = modal.querySelectorAll('.artdeco-inline-feedback--error, .fb-dash-form-element__error');
      const errors = Array.from(errorMsgs).map(e => e.textContent.trim()).filter(Boolean);
      
      result.success = false;
      result.data = { 
        applicationSent: false, 
        modalStillOpen: true,
        validationErrors: errors
      };
    }
  }

  // ═══════════════════════════════════════════════════
  // ACTION: scrollJobList — Scroll for more jobs / pagination
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'scrollJobList') {
    const seeMoreBtn = document.querySelector('.jobs-search-results-list__pagination button, .infinite-scroller__show-more-button, button[aria-label="See more jobs"]');
    
    if (seeMoreBtn) {
      realClick(seeMoreBtn);
      result.success = true;
      result.data = { action: 'clickedSeeMore' };
    } else {
      const currentPage = document.querySelector('.artdeco-pagination__indicator--number.active, .artdeco-pagination__indicator--number.selected');
      if (currentPage) {
        const nextPage = currentPage.nextElementSibling;
        if (nextPage) {
          const link = nextPage.querySelector('button, a');
          if (link) {
            realClick(link);
            result.success = true;
            result.data = { action: 'nextPage' };
          } else {
            result.success = false;
            result.error = 'NO_MORE_PAGES';
          }
        } else {
          result.success = false;
          result.error = 'NO_MORE_PAGES';
        }
      } else {
        const listContainer = document.querySelector('.jobs-search-results-list, .scaffold-layout__list');
        if (listContainer) {
          listContainer.scrollTop = listContainer.scrollHeight;
          result.success = true;
          result.data = { action: 'scrolled' };
        } else {
          result.success = false;
          result.error = 'NO_LIST_CONTAINER';
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // ACTION: getJobDescription — Extract CLEAN PLAIN TEXT job details
  // Extracts text only, strips all HTML tags
  // ═══════════════════════════════════════════════════
  else if (ACTION === 'getJobDescription') {
    // Job title from the detail pane
    const titleEl = document.querySelector(
      '.job-details-jobs-unified-top-card__job-title h1 a, ' +
      '.job-details-jobs-unified-top-card__job-title h1, ' +
      '.jobs-unified-top-card__job-title, ' +
      'h1.t-24.t-bold, ' +
      'h1.t-24'
    );

    // Company name from detail pane
    const companyEl = document.querySelector(
      '.job-details-jobs-unified-top-card__company-name a, ' +
      '.job-details-jobs-unified-top-card__company-name, ' +
      '.jobs-unified-top-card__company-name a, ' +
      '.jobs-unified-top-card__subtitle-primary-grouping a'
    );

    // Location from detail pane
    const locationEl = document.querySelector(
      '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text--low-emphasis, ' +
      '.jobs-unified-top-card__bullet, ' +
      '.jobs-unified-top-card__subtitle-secondary-grouping span'
    );

    // Work type badges (Remote, Full-time, etc.)
    const workTypeBadges = document.querySelectorAll('.job-details-fit-level-preferences button span');
    const workTypes = Array.from(workTypeBadges).map(s => s.textContent.trim()).filter(Boolean);

    // Job description — extract as PLAIN TEXT
    const descContainer = document.querySelector(
      '#job-details, ' +
      '.jobs-description__content, ' +
      '.jobs-description-content__text, ' +
      '.jobs-box__html-content, ' +
      '.jobs-description'
    );

    const description = plainText(descContainer);

    // Company info — extract as PLAIN TEXT
    const companyInfoEl = document.querySelector('.jobs-company__company-description');
    const companyInfo = plainText(companyInfoEl);

    // Company details (industry, size)
    const companyDetailsEl = document.querySelector('.jobs-company__box .t-14.mt5');
    const companyDetails = companyDetailsEl?.textContent?.trim()?.replace(/\s+/g, ' ') || '';

    result.success = true;
    result.data = {
      title: titleEl?.textContent?.trim() || '',
      company: companyEl?.textContent?.trim() || '',
      location: locationEl?.textContent?.trim() || '',
      workTypes,
      companyDetails,
      companyInfo: companyInfo.substring(0, 500),
      description: description.substring(0, 5000)
    };
  }

  return JSON.stringify(result);

})(FIELD_MAP_PLACEHOLDER, USER_PROFILE_PLACEHOLDER, OPTIONS_PLACEHOLDER);
