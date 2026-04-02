# Agentic Form Filler - Code Structure Guide

This document shows the exact structure of files that need to be created/modified.

---

## ✅ TO CREATE: `engine/agentic-form-filler.js`

```javascript
/**
 * AgenticFormFiller - Universal form filling using AI + DOM context
 *
 * Architecture:
 * 1. Snapshot: Reads DOM with rich context (sections, labels, ARIA)
 * 2. Batch AI: Sends ALL unknown fields to AI in ONE call
 * 3. Apply: Fills all field types (native, custom widgets, ARIA)
 * 4. Validate: Scans for validation errors after filling
 * 5. Correct: Auto-corrects failed validations (max 2-3 loops)
 */

class AgenticFormFiller {
  constructor(aiService) {
    this.aiService = aiService;
    this.maxCorrectionIterations = 3;
  }

  /**
   * Main entry point for form filling
   * @param {Object} webview - Electron webview element or page object
   * @param {Object} jobContext - Job info { title, company, description, location }
   * @param {Object} userProfile - User profile with all data
   * @returns {Promise<Object>} { totalFields, filledCount, aiFilledCount, errors, validationErrors }
   */
  async fillForm(webview, jobContext, userProfile) {
    const result = {
      totalFields: 0,
      filledCount: 0,
      aiFilledCount: 0,
      correctedCount: 0,
      skippedCount: 0,
      errors: [],
      validationErrors: [],
      correctionPasses: 0,
      pageSnapshot: null,
    };

    try {
      // PHASE 1: Snapshot form fields with context
      console.log("📸 Phase 1: Snapshotting form fields...");
      const snapshot = await this._executeInPage(webview, "snapshotFormFields");

      if (!snapshot || !snapshot.fields) {
        result.errors.push("Failed to snapshot form fields");
        return result;
      }

      result.totalFields = snapshot.fields.length;
      result.pageSnapshot = snapshot;

      // PHASE 2: Batch AI processing
      console.log(
        `🤖 Phase 2: Batch AI processing for ${snapshot.unknownFields.length} unknown fields...`,
      );
      let aiAnswers = [];

      if (snapshot.unknownFields.length > 0 && this.aiService) {
        try {
          aiAnswers = await this.aiService.answerQuestionsAgentic(
            snapshot.unknownFields,
            jobContext,
            userProfile,
            false, // correctionMode = false
          );
          console.log(`✅ AI returned ${aiAnswers.length} answers`);
        } catch (aiErr) {
          result.errors.push(`AI service error: ${aiErr.message}`);
          console.error("❌ AI Error:", aiErr);
        }
      }

      // PHASE 3: Apply answers to form
      console.log("📝 Phase 3: Applying answers...");
      const filled = await this._executeInPage(webview, "applyAnswers", [
        snapshot.fields,
        aiAnswers,
      ]);
      result.filledCount = filled || 0;
      result.aiFilledCount = aiAnswers.length > 0 ? result.filledCount : 0;

      // PHASE 4: Scan for validation errors
      console.log("🔍 Phase 4: Scanning for validation errors...");
      await this._delay(1500); // Let form validation run

      let validationErrors = await this._executeInPage(
        webview,
        "scanValidationErrors",
      );
      result.validationErrors = validationErrors || [];

      // PHASE 5: Correction loop
      if (validationErrors && validationErrors.length > 0) {
        console.log(
          `⚠️ ${validationErrors.length} validation errors detected, starting correction loop...`,
        );

        for (
          let pass = 0;
          pass < this.maxCorrectionIterations && validationErrors.length > 0;
          pass++
        ) {
          console.log(`🔄 Correction Pass ${pass + 1}...`);

          try {
            // Ask AI to correct the errors
            const corrections = await this.aiService.answerQuestionsAgentic(
              validationErrors,
              jobContext,
              userProfile,
              true, // correctionMode = true
            );

            // Apply corrections
            await this._executeInPage(webview, "applyAnswers", [
              validationErrors,
              corrections,
            ]);
            result.correctedCount += corrections.length;

            // Re-scan
            await this._delay(1000);
            validationErrors = await this._executeInPage(
              webview,
              "scanValidationErrors",
            );
            result.validationErrors = validationErrors || [];
            result.correctionPasses++;
          } catch (corrErr) {
            result.errors.push(
              `Correction pass ${pass + 1} failed: ${corrErr.message}`,
            );
            break;
          }
        }
      }

      if (validationErrors && validationErrors.length > 0) {
        result.errors.push(
          `${validationErrors.length} validation errors remain after ${result.correctionPasses} correction passes`,
        );
      }
    } catch (err) {
      result.errors.push(`Fatal error: ${err.message}`);
      console.error("❌ Fatal:", err);
    }

    return result;
  }

  /**
   * Execute a function in the webpage context
   * @param {Object} webview - Electron webview or puppeteer page
   * @param {string} functionName - Name of injected function to call
   * @param {Array} args - Arguments to pass to function
   * @returns {Promise} Result from injected function
   */
  async _executeInPage(webview, functionName, args = []) {
    try {
      // For Electron webview (executeScript returns string JSON)
      if (webview.executeScript) {
        return new Promise((resolve, reject) => {
          webview.executeScript(
            `
            (() => {
              if (typeof ${functionName} === 'undefined') {
                throw new Error('${functionName} not found in page');
              }
              try {
                return JSON.stringify(${functionName}(${JSON.stringify(args)}));
              } catch (e) {
                return JSON.stringify({ error: e.message });
              }
            })()
          `,
            (result) => {
              if (result && result.length > 0) {
                try {
                  const parsed = JSON.parse(result[0]);
                  if (parsed.error) reject(new Error(parsed.error));
                  else resolve(parsed);
                } catch (e) {
                  reject(e);
                }
              } else {
                reject(new Error(`No result from ${functionName}`));
              }
            },
          );
        });
      }

      // For Puppeteer (evaluate returns direct value)
      if (webview.evaluate) {
        return await webview.evaluate(
          (funcName, funcArgs) => {
            if (typeof window[funcName] === "undefined") {
              throw new Error(`${funcName} not found in page`);
            }
            return window[funcName](...funcArgs);
          },
          functionName,
          args,
        );
      }

      throw new Error("Unsupported webview type");
    } catch (err) {
      console.error(`Error executing ${functionName}:`, err);
      throw err;
    }
  }

  _delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

module.exports = { AgenticFormFiller };
```

---

## ✅ TO MODIFY: `engine/injector.js`

**Current state**: Injects field scanning functions

**What to add**: Add these functions to INJECT into the webpage context

```javascript
const INJECTED_FUNCTIONS = `
// ─────────────────────────────────────────────────────────────────
// INJECTED FUNCTIONS (run in webpage context, not Node.js)
// ─────────────────────────────────────────────────────────────────

// Helper: Build CSS selector
function buildSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  if (el.name) return el.tagName.toLowerCase()+'[name="'+CSS.escape(el.name)+'"]';
  
  const path = [];
  let current = el;
  while (current && current !== document.body && path.length < 7) {
    if (current.id) {
      path.unshift('#' + CSS.escape(current.id));
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(c => c.tagName === current.tagName);
      const idx = siblings.indexOf(current) + 1;
      path.unshift(current.tagName.toLowerCase()+(siblings.length>1?':nth-of-type('+idx+')':''));
    }
    current = parent;
  }
  return path.join(' > ');
}

// Helper: Get section context (walk up DOM for section headings)
function getSectionContext(el) {
  const contexts = [];
  let node = el.parentElement;
  let depth = 0;
  
  while (node && depth < 15) {
    // Check for section headings
    const headings = node.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > legend');
    headings.forEach(h => {
      const text = h.textContent.trim().replace(/\\s+/g, ' ');
      if (text && text.length < 120 && !contexts.includes(text)) {
        contexts.push(text);
      }
    });
    
    // Check ARIA labels
    const ariaLabel = node.getAttribute('aria-label');
    if (ariaLabel && !contexts.includes(ariaLabel)) contexts.push(ariaLabel);
    
    node = node.parentElement;
    depth++;
  }
  
  return contexts.slice(0, 2).join(' > ');
}

// Helper: Get field label
function getFieldLabel(el) {
  // Try <label for="id">
  if (el.id) {
    const label = document.querySelector('label[for="'+el.id+'"]');
    if (label) return label.textContent.trim().replace(/\\s+/g, ' ').replace(/\\*/g, '').trim();
  }
  
  // Try parent <label>
  const parentLabel = el.closest('label');
  if (parentLabel) return parentLabel.textContent.trim().replace(/[^\\w\\s]/g, ' ').trim();
  
  // Try aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  
  // Try placeholder
  if (el.placeholder) return el.placeholder.trim();
  
  return el.name || '';
}

// Helper: Check visibility
function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// Main: Snapshot all form fields with context
function snapshotFormFields() {
  const fields = [];
  const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), select, textarea');
  
  inputs.forEach(el => {
    if (!isVisible(el)) return;
    
    const label = getFieldLabel(el);
    const section = getSectionContext(el);
    const fullLabel = [section, label].filter(Boolean).join(' > ');
    
    let options = [];
    if (el.tagName === 'SELECT') {
      options = [...el.options].map(o => o.text.trim()).filter(Boolean);
    }
    
    fields.push({
      selector: buildSelector(el),
      tagName: el.tagName.toLowerCase(),
      type: el.type || (el.tagName === 'SELECT' ? 'select' : 'textarea'),
      label: fullLabel.substring(0, 250),
      rawLabel: label,
      sectionContext: section,
      name: el.name || '',
      currentValue: el.value || '',
      options: options,
      required: el.required,
      hasValidationError: el.hasAttribute('aria-invalid') || false
    });
  });
  
  // Filter out already-filled fields (unless required)
  const unknownFields = fields.filter(f => {
    if (f.required && !f.currentValue) return true;
    if (!f.currentValue) return true;
    return false;
  });
  
  return {
    fields: fields,
    unknownFields: unknownFields,
    totalFields: fields.length
  };
}

// Main: Apply answers to fields
function applyAnswers(fields, answers) {
  let filled = 0;
  
  if (!answers || !Array.isArray(answers)) return filled;
  
  for (const field of fields) {
    // Find matching answer
    const answer = answers.find(a => {
      if (!a || !a.answer) return false;
      const al = (a.label || '').toLowerCase().replace(/[^a-z0-9\\s]/g, '').trim();
      const fl = (field.label || '').toLowerCase().replace(/[^a-z0-9\\s]/g, '').trim();
      return fl.includes(al) || al.includes(fl);
    });
    
    if (!answer || answer.answer === 'SKIP') continue;
    
    const el = document.querySelector(field.selector);
    if (!el) continue;
    
    try {
      if (el.tagName === 'SELECT') {
        // Match and select option
        const opts = [...el.options];
        const target = answer.answer.toLowerCase().trim();
        const match = opts.find(o => o.text.toLowerCase().includes(target)) || opts[0];
        if (match) {
          el.value = match.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        }
      } else if (el.type === 'checkbox') {
        const shouldCheck = /^(yes|true|1|agree)$/i.test(answer.answer);
        el.checked = shouldCheck;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      } else if (el.type === 'radio') {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      } else {
        el.value = answer.answer;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
    } catch (err) {
      console.error('Error filling', field.label, err);
    }
  }
  
  return filled;
}

// Main: Scan for validation errors
function scanValidationErrors() {
  const errors = [];
  const seen = new Set();
  
  // Check invalid elements
  document.querySelectorAll('input:invalid, select:invalid, textarea:invalid, [aria-invalid="true"]').forEach(el => {
    if (!isVisible(el)) return;
    const sel = buildSelector(el);
    if (seen.has(sel)) return;
    seen.add(sel);
    
    errors.push({
      selector: sel,
      label: [getSectionContext(el), getFieldLabel(el)].filter(Boolean).join(' > '),
      type: el.type || 'unknown',
      currentValue: el.value || '',
      validationMessage: el.validationMessage || '',
      hasError: true
    });
  });
  
  return errors;
}
`;

// Export or insert into page
module.exports = { INJECTED_FUNCTIONS };
```

---

## ✅ TO MODIFY: `engine/ai-service.js`

**Add this method**:

```javascript
/**
 * Batch process ALL unknown fields at once (agentic approach)
 * @param {Array} fields - All unknown fields with context
 * @param {Object} jobContext - Job info { title, company, description, location }
 * @param {Object} userProfile - User profile
 * @param {Boolean} correctionMode - Are we correcting validation errors?
 * @returns {Array} Array of { label, answer, confidence, reasoning }
 */
async answerQuestionsAgentic(fields, jobContext, userProfile, correctionMode = false) {
  if (!this.initialized) this.initialize();

  if (!fields || fields.length === 0) return [];

  const prompt = correctionMode
    ? this._buildCorrectionPrompt(fields, userProfile)
    : this._buildAgenticPrompt(fields, jobContext, userProfile);

  console.log(`🤖 Calling AI for ${fields.length} fields (batch mode, correction=${correctionMode})...`);

  const { client } = this._getNextHealthyClient();

  try {
    const model = client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are an expert job application assistant. Return ONLY valid JSON.'
    });

    const response = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.2 }
    });

    const responseText = response.response.text();
    return this._parseAgenticResponse(responseText, fields);

  } catch (err) {
    console.error('AI Error:', err);
    throw err;
  }
}

_buildAgenticPrompt(fields, jobContext, userProfile) {
  return `You are filling out a job application for:
- Job Title: ${jobContext.title}
- Company: ${jobContext.company}
- Location: ${jobContext.location}

USER PROFILE:
${JSON.stringify({
  name: userProfile.firstName + ' ' + userProfile.lastName,
  email: userProfile.email,
  phone: userProfile.phone,
  homeCity: userProfile.homeCity,
  homeState: userProfile.homeState,
  education: userProfile.education,
  jobExperience: userProfile.jobExperience
}, null, 2)}

FORM FIELDS TO FILL (with section context):
${fields.map(f => \`
- [\${f.sectionContext || 'General'}]
  Field: \${f.label}
  Type: \${f.type}
  Required: \${f.required}
  Current Value: "\${f.currentValue}"
  Options: \${f.options ? f.options.join(', ') : 'N/A'}
\`).join('\n')}

CRITICAL RULES:
1. Understand the SECTION CONTEXT (Work Experience ≠ Home Address ≠ Education)
2. Match user profile values to the correct context
3. For "Work Experience City" → Use company location, NOT home city
4. For "Home Address" → Use home profile addresses
5. If unsure, respond "SKIP"
6. Return ONLY valid JSON array

Return JSON array like:
[
  { "label": "Work Experience #1 > Company", "answer": "Google", "confidence": "HIGH" },
  { "label": "Home Address > City", "answer": "New York", "confidence": "HIGH" },
  { "label": "Unknown Field", "answer": "SKIP", "confidence": "LOW", "reason": "No matching profile data" }
]`;
}

_buildCorrectionPrompt(errors, userProfile) {
  return `These form fields failed validation:

${errors.map(e => \`
- Field: \${e.label}
  Error: \${e.validationMessage}
  Current Value: "\${e.currentValue}"
\`).join('\n')}

USER PROFILE DATA:
${JSON.stringify(userProfile, null, 2)}

Please provide CORRECTED values for the failing fields.
Return JSON array with { label, answer, confidence, reason }`;
}

_parseAgenticResponse(responseText, fields) {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const answers = JSON.parse(jsonStr);

    if (!Array.isArray(answers)) {
      console.warn('Response is not array:', responseText);
      return [];
    }

    return answers.map(a => ({
      label: a.label,
      answer: a.answer,
      confidence: a.confidence || 'MEDIUM',
      reason: a.reason || ''
    }));

  } catch (err) {
    console.error('Failed to parse AI response:', err, responseText);
    return [];
  }
}
```

---

## ✅ TO MODIFY: `engine/apply-loop.js`

**Change these lines** (around line 50-55):

```javascript
// OLD:
const FormFiller = require("./form-filler");
const fieldMap = profileStore.getFieldMap();
this.formFiller = new FormFiller(fieldMap, this.aiService);

// NEW:
const { AgenticFormFiller } = require("./agentic-form-filler");
this.formFiller = new AgenticFormFiller(this.aiService);
```

**Change the fill call** (around line 120):

```javascript
// OLD:
const result = await this.formFiller.fillForm(page, jobContext, this.profile);

// NEW:
// Inject the agentic filler functions into the page
await this._injectAgenticFunctions(page);
const result = await this.formFiller.fillForm(page, jobContext, this.profile);

// Add this method:
async _injectAgenticFunctions(page) {
  const { INJECTED_FUNCTIONS } = require('./injector');
  await page.evaluateOnNewDocument(INJECTED_FUNCTIONS);
}
```

---

## File Deletion

**Delete entirely**:

- ❌ `engine/form-filler.js` (replace with agentic-form-filler.js)
- ❌ Remove `ProfileStore.getFieldMap()` method

---

## Summary of Changes

| File                     | Action       | Lines                            |
| ------------------------ | ------------ | -------------------------------- |
| `agentic-form-filler.js` | CREATE (new) | ~300                             |
| `injector.js`            | UPDATE       | +400 lines of injected functions |
| `ai-service.js`          | UPDATE       | +200 lines (new methods)         |
| `apply-loop.js`          | UPDATE       | ~5 changes                       |
| `form-filler.js`         | DELETE       | -                                |
| `profile-store.js`       | UPDATE       | Remove `getFieldMap()`           |

**Total New Code**: ~400-500 lines
**Total Modified**: ~600 lines
**Total Deleted**: ~300 lines (old form-filler)
