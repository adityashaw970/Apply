/**
 * Form Filler - Detects and fills form fields using user profile + AI fallback
 */
class FormFiller {
  constructor(profileFieldMap, aiService) {
    this.fieldMap = profileFieldMap;
    this.aiService = aiService;
  }

  /**
   * Detect if a field is part of a work experience section
   * This prevents greedy matching of fields like "city" or "description"
   * to home address city when they're actually asking for work location
   *
   * ⚠️ NOTE: Returns true for STRONG signals + CONTEXTUAL patterns
   */
  _isWorkExperienceField(field) {
    const label = field.label.toLowerCase();
    const fieldName = field.name ? field.name.toLowerCase() : "";

    // STRONG INDICATORS - These ALWAYS mean work experience
    const strongWorkExperienceIndicators = [
      "work experience",
      "employment history",
      "employment details",
      "previous employment",
      "employment information",
      "job history",
      "professional experience",
      "work history",
      "dates of employment",
      "employment to",
      "employment from",
      "your title",
      "job title",
      "currently work",
      "i currently work",
    ];

    // Check section label (most reliable indicator)
    if (field.sectionLabel) {
      const sectionLabel = field.sectionLabel.toLowerCase();
      for (const indicator of strongWorkExperienceIndicators) {
        if (sectionLabel.includes(indicator)) {
          return true;
        }
      }
      // Also check if section explicitly mentions these
      if (
        sectionLabel.includes("work") &&
        (sectionLabel.includes("experience") ||
          sectionLabel.includes("history") ||
          sectionLabel.includes("employment"))
      ) {
        return true;
      }
    }

    // Field-level strong indicators (must be very specific)
    const strongFieldIndicators = [
      /^employment.*from\s*date$/i,
      /^employment.*to\s*date$/i,
      /^work.*from\s*date$/i,
      /^work.*to\s*date$/i,
      /^previous.*company$/i,
      /^previous.*employer$/i,
      /^previous.*job\s*title$/i,
      /^current.*employer$/i,
      /^employer.*name$/i,
      /^currently\s*working$/i,
      /^still\s*working$/i,
      /^your\s*title$/i,
      /^job\s*title$/i,
      /^i\s*currently\s*work$/i,
      /^from\s*(month|date|year)/i,
      /^to\s*(month|date|year)/i,
    ];

    for (const indicator of strongFieldIndicators) {
      if (indicator.test(label) || indicator.test(fieldName)) {
        return true;
      }
    }

    // CONTEXTUAL: If field contains keywords that ONLY appear in work experience context
    // "Company" or "Description" are only work-related in work experience repeating sections
    // But in form-filler.js context, we can infer from label patterns
    // EXCLUDE interest/motivation questions like "What interests you about working for this company?"
    const isInterestQuestion = label.includes("interest") || label.includes("why") ||
      label.includes("motivat") || label.includes("excit") || label.includes("passion") ||
      label.includes("what draws") || label.includes("about working");

    if (!isInterestQuestion) {
      if (label.includes("for ") && label.includes("company")) {
        // "worked for X company"
        return true;
      }

      if (label.includes("company you") || label.includes("company where")) {
        return true;
      }
    }

    // DO NOT use weak indicators like just "company", just "city", just "description"
    // These appear in too many different contexts and cause false positives

    return false;
  }

  /**
   * Main entry: scan a page for form fields, fill them
   * @param {import('puppeteer').Page} page - Puppeteer page
   * @param {Object} jobContext - { title, company, description }
   * @param {Object} userProfile - Full user profile object
   * @returns {Object} { filledCount, aiFilledCount, skippedCount, skippedAnswers, errors }
   */
  async fillForm(page, jobContext, userProfile) {
    const result = {
      filledCount: 0,
      aiFilledCount: 0,
      skippedCount: 0,
      skippedAnswers: [],
      errors: [],
    };

    try {
      // Step 1: Scan all form fields
      const fields = await this._scanFormFields(page);
      if (fields.length === 0) {
        return { ...result, errors: ["No form fields found on page"] };
      }

      console.log(`📝 Detected ${fields.length} form fields:`);
      fields.forEach((f, i) => {
        console.log(`  ${i + 1}. [${f.type}] ${f.label} (${f.componentType})`);
      });

      // Step 2: Match and fill known fields
      const unknownFields = [];
      const hasWorkExperience =
        Array.isArray(userProfile?.workExperiences) &&
        userProfile.workExperiences.length > 0;

      for (const field of fields) {
        // 🚫 CRITICAL: Skip work experience section fields if user has no work experience
        if (!hasWorkExperience && this._isWorkExperienceField(field)) {
          console.log(
            `⏭️  Skipping work experience field "${field.label}" (no work experience data)`,
          );
          result.skippedAnswers.push({
            label: field.label,
            answer: "N/A",
            reason: "No work experience in profile - skipped entire section",
          });
          result.skippedCount++;
          continue; // Skip to next field without trying to fill
        }

        const matched = this._matchField(field);
        if (matched && matched.trim() !== "") {
          try {
            await this._fillField(page, field, matched);
            result.filledCount++;
          } catch (err) {
            result.errors.push(
              `Failed to fill "${field.label}": ${err.message}`,
            );
          }
        } else {
          unknownFields.push(field);
        }
      }

      // Step 3: Send unknown fields to AI
      if (unknownFields.length > 0 && this.aiService) {
        try {
          // Get page URL for website context
          const pageUrl = page.url();

          // DEDUPLICATE questions: remove exact duplicates and generic placeholders
          const seen = new Map(); // Track by label to deduplicate
          const questionsForAI = [];
          const indexMap = []; // Map from deduped index back to original unknownFields index

          unknownFields.forEach((field, idx) => {
            const label = field.label.toLowerCase().trim();

            // Skip generic placeholders
            if (
              label === "enter your answer..." ||
              label === "" ||
              label.length < 3
            ) {
              return;
            }

            // If we haven't seen this question before, add it
            if (!seen.has(label)) {
              seen.set(label, field);
              questionsForAI.push({
                label: field.label,
                type: field.type,
                options: field.options,
              });
              indexMap.push(idx); // Remember which original field this maps to
            }
          });

          console.log(
            `📋 Deduped: ${unknownFields.length} → ${questionsForAI.length} unique questions`,
          );

          if (questionsForAI.length === 0) {
            console.log("⚠️ No valid questions after deduplication");
            return result;
          }

          const aiAnswers = await this.aiService.answerQuestions(
            questionsForAI,
            jobContext,
            userProfile,
            pageUrl, // Pass page URL for better context
          );

          // Map answers back to original unknown fields
          for (let i = 0; i < aiAnswers.length; i++) {
            const answer = aiAnswers[i];
            const originalIdx = indexMap[i]; // Get original field index
            const field = unknownFields[originalIdx];

            if (
              answer.answer &&
              answer.answer.trim() !== "" &&
              answer.answer !== "N/A"
            ) {
              try {
                await this._fillField(page, field, answer.answer);
                result.aiFilledCount++;
              } catch (err) {
                result.errors.push(
                  `AI fill failed for "${field.label}": ${err.message}`,
                );
                // Track skipped answer even if fill failed
                result.skippedAnswers.push({
                  label: field.label,
                  answer: answer.answer,
                  reason: "Failed to fill field",
                });
                result.skippedCount++;
              }
            } else {
              // Answer is empty or N/A - skip but track it
              result.skippedAnswers.push({
                label: field.label,
                answer: answer.answer || "N/A",
                reason: "No valid answer from AI",
              });
              result.skippedCount++;
            }
          }
        } catch (aiErr) {
          result.errors.push(`AI service error: ${aiErr.message}`);
          result.skippedCount += unknownFields.length;
          // Add all unknown fields as skipped if AI service fails
          unknownFields.forEach((f) => {
            result.skippedAnswers.push({
              label: f.label,
              answer: "N/A",
              reason: "AI service error",
            });
          });
        }
      } else {
        result.skippedCount += unknownFields.length;
        // Add all unknown fields as skipped if no AI service
        unknownFields.forEach((f) => {
          result.skippedAnswers.push({
            label: f.label,
            answer: "N/A",
            reason: "No AI service available",
          });
        });
      }
    } catch (error) {
      result.errors.push(`Form scan error: ${error.message}`);
    }

    return result;
  }

  /**
   * Scan page for all fillable form fields - including Radix UI components
   */
  async _scanFormFields(page) {
    return await page.evaluate(() => {
      const fields = [];
      const processedLabels = new Set();

      // Helper to extract label from card structure
      const extractCardLabel = (cardEl) => {
        const titleEl = cardEl.querySelector('[data-slot="card-title"]');
        if (titleEl) return titleEl.textContent.trim();

        for (const heading of cardEl.querySelectorAll("h2, h3, h4")) {
          const text = heading.textContent.trim();
          if (text.length > 0) return text;
        }

        const labelEl = cardEl.querySelector("label[data-slot='label']");
        if (labelEl) return labelEl.textContent.trim();

        return "";
      };

      // 1. Scan all cards in order (most reliable for Turing forms)
      const cards = document.querySelectorAll('[data-slot="card"]');
      cards.forEach((card, cardIdx) => {
        const cardLabel = extractCardLabel(card);
        if (!cardLabel || processedLabels.has(cardLabel)) return;
        processedLabels.add(cardLabel);

        // Check for textareas
        const textarea = card.querySelector("textarea");
        if (textarea) {
          fields.push({
            selector: `textarea`,
            tagName: "textarea",
            type: "textarea",
            label: cardLabel,
            name: textarea.name || "",
            value: textarea.value || "",
            required: textarea.required,
            componentType: "native",
            cardIndex: cardIdx,
          });
          return;
        }

        // Check for radio groups
        const radioGroup = card.querySelector('[role="radiogroup"]');
        if (radioGroup) {
          const radios = radioGroup.querySelectorAll('[role="radio"]');
          const options = [];
          radios.forEach((radio) => {
            const labelEl = radio.nextElementSibling;
            if (labelEl) {
              const text = labelEl.textContent.trim();
              if (text) options.push(text);
            }
          });

          if (options.length > 0) {
            fields.push({
              selector: `[role="radiogroup"]`,
              tagName: "radix-radio-group",
              type: "radix-radio",
              label: cardLabel,
              options,
              required: false,
              componentType: "radix-ui",
              cardIndex: cardIdx,
            });
            return;
          }
        }

        // Check for combobox
        const combobox = card.querySelector('[role="combobox"]');
        if (combobox) {
          fields.push({
            selector: `[role="combobox"]`,
            tagName: "radix-combobox",
            type: "radix-select",
            label: cardLabel,
            value: combobox.textContent.trim().substring(0, 100),
            required: false,
            componentType: "radix-ui",
            cardIndex: cardIdx,
          });
          return;
        }

        // Check for checkbox field
        const checkbox = card.querySelector('[role="checkbox"]');
        if (checkbox) {
          const labelEl = checkbox.nextElementSibling;
          if (labelEl) {
            const checkboxLabel = labelEl.textContent.trim();
            fields.push({
              selector: `[role="checkbox"]`,
              tagName: "radix-checkbox",
              type: "radix-checkbox",
              label: checkboxLabel || cardLabel,
              required: false,
              componentType: "radix-ui",
              cardIndex: cardIdx,
            });
            return;
          }
        }

        // Check for text input
        const input = card.querySelector(
          'input[type="text"], input[type="email"], input[type="url"]',
        );
        if (input) {
          fields.push({
            selector: `input[type="text"], input[type="email"], input[type="url"]`,
            tagName: "input",
            type: input.type,
            label: cardLabel,
            name: input.name || "",
            value: input.value || "",
            required: input.required,
            componentType: "native",
            cardIndex: cardIdx,
          });
          return;
        }
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
      field.name.replace(/[_-]/g, " ").toLowerCase(),
    ].filter((t) => t.length > 0);

    // Direct match
    for (const term of searchTerms) {
      if (this.fieldMap[term]) return this.fieldMap[term];
    }

    // Partial match — check if any field map key is contained in the label or vice versa
    for (const term of searchTerms) {
      for (const [key, value] of Object.entries(this.fieldMap)) {
        if (!value || value === "") continue;
        if (term.includes(key) || key.includes(term)) {
          return value;
        }
      }
    }

    // Word-level match — check if significant words overlap
    for (const term of searchTerms) {
      const termWords = term.split(/\s+/).filter((w) => w.length > 2);
      for (const [key, value] of Object.entries(this.fieldMap)) {
        if (!value || value === "") continue;
        const keyWords = key.split(/\s+/).filter((w) => w.length > 2);
        const overlap = termWords.filter((w) => keyWords.includes(w));
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
    // For Radix UI components, use card-based approach
    if (field.componentType === "radix-ui") {
      try {
        if (field.type === "radix-radio") {
          await this._fillRadixRadio(page, field, value);
        } else if (field.type === "radix-checkbox") {
          await this._fillRadixCheckbox(page, field, value);
        } else if (field.type === "radix-select") {
          await this._fillRadixSelect(page, field, value);
        }
        return;
      } catch (err) {
        console.error(
          `Error filling Radix component "${field.label}": ${err.message}`,
        );
        throw err;
      }
    }

    // For native elements, find element and fill
    try {
      let el = null;

      // Try multiple strategies to find the element
      const strategies = [
        () => page.$(field.selector),
        () => page.$(`[name="${field.name}"]`) || null,
        () => page.$("textarea") || null,
        () => page.$("input[type='text']") || null,
      ];

      for (const strategy of strategies) {
        el = await strategy();
        if (el) break;
      }

      if (!el) {
        throw new Error(`Element not found for field "${field.label}"`);
      }

      await this._fillElement(page, el, field, value);
    } catch (err) {
      console.error(
        `Error filling native field "${field.label}": ${err.message}`,
      );
      throw err;
    }
  }

  async _fillElement(page, element, field, value) {
    switch (field.type) {
      case "select":
      case "select-one":
        await this._fillSelect(page, element, field, value);
        break;

      case "checkbox":
        await this._fillCheckbox(element, value);
        break;

      case "radio":
        await this._fillRadio(page, field, value);
        break;

      case "radix-radio":
        await this._fillRadixRadio(page, field, value);
        break;

      case "radix-checkbox":
        await this._fillRadixCheckbox(page, field, value);
        break;

      case "radix-select":
        await this._fillRadixSelect(page, field, value);
        break;

      case "date":
        await element.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
        break;

      case "number":
        await element.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
        break;

      default:
        // Text, email, tel, textarea, etc.
        if (element) {
          await element.click({ clickCount: 3 }); // Select all existing text
          await element.type(value, { delay: 20 });
        }
        break;
    }
  }

  async _fillSelect(page, element, field, value) {
    // Try to find the best matching option
    const optionValue = await element.evaluate((el, targetValue) => {
      const options = Array.from(el.options);
      const target = targetValue.toLowerCase().trim();

      // Exact text match
      let match = options.find((o) => o.text.toLowerCase().trim() === target);
      if (match) return match.value;

      // Exact value match
      match = options.find((o) => o.value.toLowerCase().trim() === target);
      if (match) return match.value;

      // Partial match
      match = options.find(
        (o) =>
          o.text.toLowerCase().includes(target) ||
          target.includes(o.text.toLowerCase()),
      );
      if (match) return match.value;

      // Word overlap match
      const targetWords = target.split(/\s+/);
      let bestMatch = null;
      let bestScore = 0;
      for (const opt of options) {
        const optWords = opt.text.toLowerCase().split(/\s+/);
        const score = targetWords.filter((w) => optWords.includes(w)).length;
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
      await element.evaluate((el) => {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }

  async _fillCheckbox(element, value) {
    const isChecked = await element.evaluate((el) => el.checked);
    const shouldCheck = [
      "yes",
      "true",
      "1",
      "agree",
      "accept",
      "check",
    ].includes(value.toLowerCase().trim());

    if (shouldCheck !== isChecked) {
      await element.click();
    }
  }

  async _fillRadio(page, field, value) {
    // Normalize value to match against labels
    const normalizedValue = value.toLowerCase().trim();

    // Find all radio buttons with the same name and select the matching one
    const radios = await page.$$(`input[type="radio"][name="${field.name}"]`);

    for (const radio of radios) {
      const radioData = await radio.evaluate((el) => {
        const label =
          el.closest("label")?.textContent?.trim() ||
          document
            .querySelector(`label[for="${el.id}"]`)
            ?.textContent?.trim() ||
          el.value;
        return {
          label: label.toLowerCase(),
          value: el.value.toLowerCase(),
          checked: el.checked,
        };
      });

      // Try to match the answer value to this radio button
      const labelMatch =
        radioData.label.includes(normalizedValue) ||
        normalizedValue.includes(radioData.label);

      const valueMatch =
        radioData.value === normalizedValue ||
        radioData.value.includes(normalizedValue.replace(/\s+/g, ""));

      // Special handling for "Yes" and "No" answers
      const isYesAnswer = normalizedValue === "yes";
      const isNoAnswer = normalizedValue === "no";

      const isYesField =
        radioData.label.includes("yes") && !radioData.label.includes("no");
      const isNoField =
        radioData.label.includes("no") && !radioData.label.includes("yes");

      if (
        labelMatch ||
        valueMatch ||
        (isYesAnswer && isYesField) ||
        (isNoAnswer && isNoField)
      ) {
        if (!radioData.checked) {
          await radio.click();
        }
        return;
      }
    }

    // If no match found, log warning but don't click anything (radio group might be handled elsewhere)
    console.warn(
      `⚠️ No matching radio for value "${value}" in field "${field.label}"`,
    );
  }

  /**
   * Fill Radix UI Radio Group
   */
  async _fillRadixRadio(page, field, value) {
    const normalizedValue = value.toLowerCase().trim();
    const cardIndex = field.cardIndex;

    console.log(`🔘 Filling radio: "${field.label}" with "${value}"`);

    await page.evaluate(
      (cardIdx, fieldLabel, ansValue) => {
        const cards = document.querySelectorAll('[data-slot="card"]');
        const targetCard = cards[cardIdx];
        if (!targetCard) {
          console.error(`Card not found at index ${cardIdx}`);
          return false;
        }

        const radioGroup = targetCard.querySelector('[role="radiogroup"]');
        if (!radioGroup) {
          console.error(`No radiogroup in target card`);
          return false;
        }

        const radios = radioGroup.querySelectorAll('[role="radio"]');
        const ansNormalized = ansValue.toLowerCase().trim();

        for (const radio of radios) {
          const labelEl = radio.nextElementSibling;
          if (!labelEl) continue;

          const labelText = labelEl.textContent.toLowerCase().trim();

          // Check for match
          const isMatch =
            labelText.includes(ansNormalized) ||
            ansNormalized.includes(labelText) ||
            (ansNormalized === "yes" && labelText.includes("yes")) ||
            (ansNormalized === "no" && labelText.includes("no"));

          if (isMatch) {
            console.log(
              `✓ Matched radio option: "${labelEl.textContent.trim()}"`,
            );

            // Update button state
            radio.setAttribute("data-state", "checked");
            radio.setAttribute("aria-checked", "true");

            // Check hidden input if exists
            const hiddenInput = radio
              .closest("div")
              ?.querySelector('input[type="radio"]');
            if (hiddenInput) {
              hiddenInput.checked = true;
              hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
            }

            // Click radio button to trigger any handlers
            radio.click();
            return true;
          }
        }

        console.warn(
          `✗ No matching option found for "${ansValue}" in radiogroup`,
        );
        return false;
      },
      cardIndex,
      field.label,
      value,
    );
  }

  /**
   * Fill Radix UI Checkbox
   */
  async _fillRadixCheckbox(page, field, value) {
    const shouldCheck = [
      "yes",
      "true",
      "1",
      "agree",
      "accept",
      "check",
    ].includes(value.toLowerCase().trim());

    console.log(
      `✓ Filling checkbox: "${field.label}" → ${shouldCheck ? "checked" : "unchecked"}`,
    );

    const cardIndex = field.cardIndex;

    await page.evaluate(
      (cardIdx, check) => {
        const cards = document.querySelectorAll('[data-slot="card"]');
        const targetCard = cards[cardIdx];
        if (!targetCard) return false;

        const checkbox = targetCard.querySelector('[role="checkbox"]');
        if (!checkbox) return false;

        // Update state
        if (check) {
          checkbox.setAttribute("data-state", "checked");
          checkbox.setAttribute("aria-checked", "true");
        } else {
          checkbox.setAttribute("data-state", "unchecked");
          checkbox.setAttribute("aria-checked", "false");
        }

        // Update hidden input
        const hiddenInput = targetCard.querySelector('input[type="checkbox"]');
        if (hiddenInput) {
          hiddenInput.checked = check;
          hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // Click to trigger handlers
        checkbox.click();
        return true;
      },
      cardIndex,
      shouldCheck,
    );
  }

  /**
   * Fill Radix UI Combobox/Select
   */
  async _fillRadixSelect(page, field, value) {
    console.log(`📋 Filling combobox: "${field.label}" with "${value}"`);

    const cardIndex = field.cardIndex;

    // First, open the combobox
    const opened = await page.evaluate((cardIdx) => {
      const cards = document.querySelectorAll('[data-slot="card"]');
      const targetCard = cards[cardIdx];
      if (!targetCard) return false;

      const combobox = targetCard.querySelector('[role="combobox"]');
      if (!combobox) return false;

      combobox.click();
      return true;
    }, cardIndex);

    if (!opened) {
      console.error(`Failed to open combobox in card ${cardIndex}`);
      return;
    }

    // Wait for dropdown to appear
    await page.waitForTimeout(300);

    // Find and click the matching option
    const found = await page.evaluate((selectValue) => {
      const normalizedValue = selectValue.toLowerCase().trim();

      // Look for dropdown options - multiple possible selectors
      const optionSelectors = [
        'div[data-state="checked"]',
        '[role="option"]',
        ".text-foreground",
      ];

      for (const selector of optionSelectors) {
        const options = document.querySelectorAll(selector);
        for (const option of options) {
          const text = option.textContent.toLowerCase().trim();
          if (
            text.includes(normalizedValue) ||
            normalizedValue.includes(text)
          ) {
            option.click();
            console.log(`✓ Selected option: "${option.textContent}"`);
            return true;
          }
        }
      }

      // Fallback: search through all visible divs
      const allDivs = document.querySelectorAll("div");
      for (const div of allDivs) {
        const text = div.textContent.toLowerCase().trim();
        if (
          text === normalizedValue &&
          div.offsetParent !== null &&
          div.getAttribute("role") !== "button"
        ) {
          div.click();
          console.log(`✓ Selected option: "${div.textContent}"`);
          return true;
        }
      }

      console.warn(`✗ No matching option found for "${selectValue}"`);
      return false;
    }, value);

    if (!found) {
      // Try clicking first visible option if no exact match
      await page.evaluate(() => {
        const option = document.querySelector('[role="option"]');
        if (option) option.click();
      });
    }
  }
}

module.exports = { FormFiller };
