/**
 * Form Filler - Detects and fills form fields using user profile + AI fallback
 */
class FormFiller {
  constructor(profileFieldMap, aiService) {
    this.fieldMap = profileFieldMap;
    this.aiService = aiService;
  }

  /**
   * Main entry: scan a page for form fields, fill them
   * @param {import('puppeteer').Page} page - Puppeteer page
   * @param {Object} jobContext - { title, company, description }
   * @param {Object} userProfile - Full user profile object
   * @returns {Object} { filledCount, aiFilledCount, skippedCount, errors }
   */
  async fillForm(page, jobContext, userProfile) {
    const result = { filledCount: 0, aiFilledCount: 0, skippedCount: 0, errors: [] };

    try {
      // Step 1: Scan all form fields
      const fields = await this._scanFormFields(page);
      if (fields.length === 0) {
        return { ...result, errors: ['No form fields found on page'] };
      }

      // Step 2: Match and fill known fields
      const unknownFields = [];
      for (const field of fields) {
        const matched = this._matchField(field);
        if (matched && matched.trim() !== '') {
          try {
            await this._fillField(page, field, matched);
            result.filledCount++;
          } catch (err) {
            result.errors.push(`Failed to fill "${field.label}": ${err.message}`);
          }
        } else {
          unknownFields.push(field);
        }
      }

      // Step 3: Send unknown fields to AI
      if (unknownFields.length > 0 && this.aiService) {
        try {
          const aiAnswers = await this.aiService.answerQuestions(
            unknownFields.map(f => ({
              label: f.label,
              type: f.type,
              options: f.options
            })),
            jobContext,
            userProfile
          );

          for (let i = 0; i < aiAnswers.length; i++) {
            const answer = aiAnswers[i];
            if (answer.answer && answer.answer.trim() !== '' && answer.answer !== 'N/A') {
              try {
                await this._fillField(page, unknownFields[i], answer.answer);
                result.aiFilledCount++;
              } catch (err) {
                result.errors.push(`AI fill failed for "${unknownFields[i].label}": ${err.message}`);
                result.skippedCount++;
              }
            } else {
              result.skippedCount++;
            }
          }
        } catch (aiErr) {
          result.errors.push(`AI service error: ${aiErr.message}`);
          result.skippedCount += unknownFields.length;
        }
      } else {
        result.skippedCount += unknownFields.length;
      }

    } catch (error) {
      result.errors.push(`Form scan error: ${error.message}`);
    }

    return result;
  }

  /**
   * Scan page for all fillable form fields
   */
  async _scanFormFields(page) {
    return await page.evaluate(() => {
      const fields = [];
      const inputs = document.querySelectorAll('input, select, textarea');

      inputs.forEach((el) => {
        // Skip hidden, submit, button, and already-filled fields
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' ||
            el.type === 'image' || el.type === 'reset' || el.type === 'file') return;
        if (el.offsetParent === null && el.type !== 'checkbox' && el.type !== 'radio') return;

        // Get label text
        let label = '';

        // Try <label> element
        if (el.id) {
          const labelEl = document.querySelector(`label[for="${el.id}"]`);
          if (labelEl) label = labelEl.textContent.trim();
        }

        // Try parent label
        if (!label) {
          const parentLabel = el.closest('label');
          if (parentLabel) {
            label = parentLabel.textContent.trim();
          }
        }

        // Try aria-label
        if (!label) label = el.getAttribute('aria-label') || '';

        // Try placeholder
        if (!label) label = el.placeholder || '';

        // Try name attribute
        if (!label) label = el.name || '';

        // Try preceding sibling text or nearby text
        if (!label) {
          const prev = el.previousElementSibling;
          if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'P')) {
            label = prev.textContent.trim();
          }
        }

        // Try parent's text content (for div-wrapped inputs)
        if (!label) {
          const parent = el.parentElement;
          if (parent) {
            const textNodes = Array.from(parent.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent.trim())
              .filter(t => t.length > 0);
            if (textNodes.length > 0) label = textNodes[0];
          }
        }

        // Get options for select elements
        let options = [];
        if (el.tagName === 'SELECT') {
          options = Array.from(el.options).map(o => o.text).filter(t => t.trim());
        }

        // Build a unique selector
        let selector = '';
        if (el.id) {
          selector = `#${CSS.escape(el.id)}`;
        } else if (el.name) {
          selector = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
        } else {
          // Fallback: use nth-of-type
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
            const idx = siblings.indexOf(el);
            selector = `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;
          }
        }

        fields.push({
          selector,
          tagName: el.tagName.toLowerCase(),
          type: el.type || (el.tagName === 'SELECT' ? 'select' : 'textarea'),
          label: label.substring(0, 200), // Truncate long labels
          name: el.name || '',
          value: el.value || '',
          options,
          required: el.required || el.getAttribute('aria-required') === 'true'
        });
      });

      return fields;
    });
  }

  /**
   * Match a form field to a profile value using fuzzy label matching
   */
  _matchField(field) {
    const searchTerms = [
      field.label.toLowerCase(),
      field.name.toLowerCase(),
      field.name.replace(/[_-]/g, ' ').toLowerCase()
    ].filter(t => t.length > 0);

    // Direct match
    for (const term of searchTerms) {
      if (this.fieldMap[term]) return this.fieldMap[term];
    }

    // Partial match — check if any field map key is contained in the label or vice versa
    for (const term of searchTerms) {
      for (const [key, value] of Object.entries(this.fieldMap)) {
        if (!value || value === '') continue;
        if (term.includes(key) || key.includes(term)) {
          return value;
        }
      }
    }

    // Word-level match — check if significant words overlap
    for (const term of searchTerms) {
      const termWords = term.split(/\s+/).filter(w => w.length > 2);
      for (const [key, value] of Object.entries(this.fieldMap)) {
        if (!value || value === '') continue;
        const keyWords = key.split(/\s+/).filter(w => w.length > 2);
        const overlap = termWords.filter(w => keyWords.includes(w));
        if (overlap.length > 0 && overlap.length >= keyWords.length * 0.5) {
          return value;
        }
      }
    }

    return null;
  }

  /**
   * Fill a single field on the page
   */
  async _fillField(page, field, value) {
    const el = await page.$(field.selector);
    if (!el) {
      // Try alternative selectors
      const altSelectors = [
        `[name="${field.name}"]`,
        `[placeholder="${field.label}"]`,
        `[aria-label="${field.label}"]`
      ];

      for (const sel of altSelectors) {
        const altEl = await page.$(sel);
        if (altEl) {
          await this._fillElement(page, altEl, field, value);
          return;
        }
      }
      throw new Error(`Element not found: ${field.selector}`);
    }

    await this._fillElement(page, el, field, value);
  }

  async _fillElement(page, element, field, value) {
    switch (field.type) {
      case 'select':
      case 'select-one':
        await this._fillSelect(page, element, field, value);
        break;

      case 'checkbox':
        await this._fillCheckbox(element, value);
        break;

      case 'radio':
        await this._fillRadio(page, field, value);
        break;

      case 'date':
        await element.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        break;

      case 'number':
        await element.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, value);
        break;

      default:
        // Text, email, tel, textarea, etc.
        await element.click({ clickCount: 3 }); // Select all existing text
        await element.type(value, { delay: 20 });
        break;
    }
  }

  async _fillSelect(page, element, field, value) {
    // Try to find the best matching option
    const optionValue = await element.evaluate((el, targetValue) => {
      const options = Array.from(el.options);
      const target = targetValue.toLowerCase().trim();

      // Exact text match
      let match = options.find(o => o.text.toLowerCase().trim() === target);
      if (match) return match.value;

      // Exact value match
      match = options.find(o => o.value.toLowerCase().trim() === target);
      if (match) return match.value;

      // Partial match
      match = options.find(o =>
        o.text.toLowerCase().includes(target) || target.includes(o.text.toLowerCase())
      );
      if (match) return match.value;

      // Word overlap match
      const targetWords = target.split(/\s+/);
      let bestMatch = null;
      let bestScore = 0;
      for (const opt of options) {
        const optWords = opt.text.toLowerCase().split(/\s+/);
        const score = targetWords.filter(w => optWords.includes(w)).length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = opt.value;
        }
      }
      if (bestScore > 0) return bestMatch;

      return null;
    }, value);

    if (optionValue !== null) {
      await element.select(optionValue);
      await element.evaluate(el => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  }

  async _fillCheckbox(element, value) {
    const isChecked = await element.evaluate(el => el.checked);
    const shouldCheck = ['yes', 'true', '1', 'agree', 'accept'].includes(value.toLowerCase());

    if (shouldCheck !== isChecked) {
      await element.click();
    }
  }

  async _fillRadio(page, field, value) {
    // Find all radio buttons with the same name and select the matching one
    const radios = await page.$$(`input[type="radio"][name="${field.name}"]`);

    for (const radio of radios) {
      const radioLabel = await radio.evaluate(el => {
        const label = el.closest('label')?.textContent?.trim() ||
                      document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() ||
                      el.value;
        return label.toLowerCase();
      });

      if (radioLabel.includes(value.toLowerCase()) || value.toLowerCase().includes(radioLabel)) {
        await radio.click();
        return;
      }
    }

    // If no match, click the first one
    if (radios.length > 0) {
      await radios[0].click();
    }
  }
}

module.exports = { FormFiller };
