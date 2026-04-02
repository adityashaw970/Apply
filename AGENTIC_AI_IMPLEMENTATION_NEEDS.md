# 🤖 MassApply: Agentic AI Form Filler - Implementation Requirements

## Executive Summary

**Current Problem**: Your form filler uses static field mapping (`firstName`, `lastName`, `city`) without understanding **context**. When a form has "Work Experience City" and "Home Address City", your system can't distinguish them → **wrong values injected**.

**Solution**: Replace static matching with AI-driven **context-aware understanding** using DOM semantic analysis + batch AI processing + self-correction loops.

**Good News**: 80% of the logic is already in the script you provided. You just need to:

1. Refactor to remove static `fieldMap` dependency
2. Implement the DOM snapshot → AI → validation loop
3. Add self-correction for validation errors

---

## Part 1: What's WRONG with Current System

### ❌ Problem #1: Static Field Mapping Loses Context

**File**: `engine/form-filler.js` (line ~80)

```javascript
_matchField(field) {
  // WRONG: This just checks field.label against hardcoded fieldMap
  // If field.label = "City", it returns userProfile.homeCity
  // DOESNT KNOW if it's "Work Experience City" or "Home City"
}
```

**Why it fails**:

- `field.label` = "City" (no section context)
- `fieldMap['city']` = userProfile.homeCity (hardcoded)
- Applied to Work Experience section → **WRONG VALUE**

### ❌ Problem #2: Hardcoded Selectors Break Across Websites

**File**: `engine/job-navigator.js`

```javascript
applyButtonSelectors = [
  'button:has-text("Apply")',
  '.
-button-container button',
  '#indeedApplyButton',  // Only works on Indeed!
  // ... 20+ site-specific selectors
]
```

**Why it fails**:

- Every website has different HTML structure
- CSS selectors are brittle and site-specific
- Adding new job site = adding 10+ new selectors
- **Doesn't scale**

### ❌ Problem #3: Sequential Field Processing → No AI Parallelization

**File**: `engine/form-filler.js`

```javascript
for (const field of unknownFields) {
  // ONE AI CALL PER FIELD
  const answer = await this.aiService.answerQuestions(
    [field],
    jobContext,
    userProfile,
  );
  // Fill field
}
// Result: 20 fields = 20 AI API calls = SLOW + EXPENSIVE
```

### ❌ Problem #4: No Validation Error Handling

After filling form → field validation fails (red border, error message) → **NOTHING HAPPENS**

- Current code doesn't check for validation errors
- No self-correction mechanism
- Form submission fails silently

---

## Part 2: What NEEDS to Change

### 🔧 Change #1: Remove Static Field Mapping

**Current**:

```javascript
// ProfileStore.js - Creates static field map
const fieldMap = {
  firstName: profile.firstName,
  lastName: profile.lastName,
  email: profile.email,
  city: profile.homeCity, // WRONG for Work Experience!
  state: profile.homeState,
  phone: profile.phone,
  // ... 30+ hardcoded mappings
};
```

**Needed**:

- **DELETE** the static `ProfileStore.getFieldMap()` approach
- **DELETE** the `_matchField()` logic in FormFiller
- Replace with **dynamic DOM context reading** (already in your script)

**Why**: Context-aware reading means:

- Field labeled "Work Experience City" → asks AI about work location
- Field labeled "Home Address City" → asks AI about home location
- **No confusion** because the AI sees the section heading

---

### 🔧 Change #2: Implement Batch AI Processing

**Current** (BAD):

```javascript
// FormFiller.js - Sequential calls
async fillForm(page, jobContext, userProfile) {
  const unknownFields = [];
  for (const field of fields) {
    if (!matched) unknownFields.push(field);
  }

  // ONE AI CALL PER FIELD (inefficient, inconsistent)
  for (const field of unknownFields) {
    const answer = await this.aiService.answerQuestions([field], jobContext, userProfile);
  }
}
```

**Needed**:

```javascript
// AgenticFormFiller.js - Batch processing
async fillForm(page, jobContext, userProfile) {
  // STEP 1: Snapshot ALL fields with context
  const fields = await this.snapshotFormFields(page);

  // STEP 2: Send ALL unknown fields to AI in ONE call
  const unknownFields = fields.filter(f => !f.currentValue || f.hasValidationError);
  const answers = await this.aiService.answerQuestionsAgentic(
    unknownFields,  // ALL fields at once
    jobContext,
    userProfile
  );

  // STEP 3: Apply all answers
  await this.applyAnswers(fields, answers);

  // STEP 4: Check for validation errors
  const errors = await this.scanValidationErrors(page);

  // STEP 5: Correction loop (if errors found)
  if (errors.length > 0 && correctionIterations < maxIterations) {
    const correctedAnswers = await this.aiService.correctValidationErrors(errors, userProfile);
    await this.applyAnswers(fields, correctedAnswers);
    // Repeat STEP 4-5
  }
}
```

**Benefits**:

- 1 AI call instead of 20 → **20x faster, cheaper**
- AI sees full form structure → **better answers**
- AI can handle interdependencies → **no contradictions**

---

### 🔧 Change #3: Implement Context-Aware Field Reading

**Current** (doesn't exist):

- No section heading detection
- No hierarchy understanding
- No ARIA attribute reading

**Needed** (ALREADY IN YOUR SCRIPT):

```javascript
function snapshotFormFields(pageContent) {
  const fields = [];

  // For EACH field, capture:
  // 1. Section context (e.g., "Work Experience > City")
  // 2. Field label (e.g., "City")
  // 3. Parent hierarchy (fieldset, section, div.form-group)
  // 4. ARIA attributes (aria-label, aria-labelledby, aria-required)
  // 5. Available options (for dropdowns)
  // 6. Current value (if pre-filled)

  fields.push({
    selector: 'input[name="work_city_1"]',
    label: "Work Experience #1 > City", // FULL CONTEXT!
    sectionContext: "Work Experience #1",
    type: "text",
    currentValue: "",
    required: true,
  });

  return fields;
}
```

**Key insight**: When AI sees "Work Experience #1 > City", it knows:

- This is asking for city of work location, NOT home
- Can access `jobContext.company_location` if available
- Won't confuse with home address city

---

### 🔧 Change #4: Implement Validation Error Detection & Correction

**Currently Missing Entirely**.

**Needed**:

```javascript
async function scanValidationErrors(page) {
  // After filling form, check for:
  return await page.evaluate(() => {
    const errors = [];

    // 1. CSS validation states
    document.querySelectorAll("input:invalid, select:invalid").forEach((el) => {
      errors.push({
        selector: buildSelector(el),
        label: getFieldLabel(el),
        currentValue: el.value,
        validationError: el.validationMessage,
        errorMessage: getVisualErrorMessage(el), // Red border text
      });
    });

    // 2. Explicit error messages near fields
    document
      .querySelectorAll('[class*="error"], [role="alert"]')
      .forEach((errEl) => {
        const nearbyInput =
          errEl.previousElementSibling?.querySelector("input");
        if (nearbyInput) {
          errors.push({
            selector: buildSelector(nearbyInput),
            validationError: errEl.textContent,
          });
        }
      });

    return errors;
  });
}

// After errors detected, call AI correction
async function correctValidationErrors(validationErrors, userProfile) {
  const prompt = `These form fields failed validation:\n${JSON.stringify(validationErrors)}\n
Please provide corrected values:\n${JSON.stringify(
    validationErrors.map((e) => ({
      field: e.label,
      currentValue: e.currentValue,
      error: e.validationError,
    })),
  )}`;

  return await this.aiService.answerQuestionsAgentic(
    validationErrors,
    { correction: true },
    userProfile,
  );
}
```

---

## Part 3: Detailed Integration Steps

### Step 1️⃣: Create New Agentic Form Filler

**New file**: `engine/agenic-form-filler.js`

**Replace**: Current `engine/form-filler.js`

**What it should do**:

```javascript
class AgenticFormFiller {
  async fillForm(webview, jobContext, userProfile) {
    // 1. Snapshot fields with AI (send to renderer)
    const snapshot = await webview.executeScript(snapshotFormFields, []);

    // 2. Batch AI call
    const answers = await aiService.answerQuestionsAgentic(
      snapshot.unknownFields,
      jobContext,
      userProfile,
    );

    // 3. Apply answers
    await webview.executeScript(applyAnswers, [snapshot.fields, answers]);

    // 4. Check for errors (wait for validation)
    await delay(1000); // Let form validate
    const errors = await webview.executeScript(scanValidationErrors, []);

    // 5. Correction loop
    let correctionPass = 0;
    while (errors.length > 0 && correctionPass < 2) {
      const corrections = await aiService.correctValidationErrors(
        errors,
        userProfile,
      );
      await webview.executeScript(applyAnswers, [errors, corrections]);
      await delay(1000);
      errors = await webview.executeScript(scanValidationErrors, []);
      correctionPass++;
    }

    return {
      fieldsFixed: snapshot.fields.length - errors.length,
      remainingErrors: errors,
      correctionPasses: correctionPass,
    };
  }
}
```

### Step 2️⃣: Update AI Service for Batch Processing

**File**: `engine/ai-service.js`

**Add method**:

```javascript
async answerQuestionsAgentic(fields, jobContext, userProfile, correctionMode = false) {
  const prompt = correctionMode
    ? this._buildCorrectionPrompt(fields, userProfile)
    : this._buildBatchPrompt(fields, jobContext, userProfile);

  // Single call with all fields
  const response = await this._callAI(prompt);
  return this._parseResponse(response, fields);
}

_buildBatchPrompt(fields, jobContext, userProfile) {
  return `You are filling a job application form. CONTEXT:
Job: ${jobContext.title} at ${jobContext.company}
Location: ${jobContext.location}

USER PROFILE:
${JSON.stringify(userProfile, null, 2)}

FORM FIELDS TO FILL (with section context):
${fields.map(f => `
- ${f.sectionContext ? f.sectionContext + ' > ' : ''}${f.label}
  Type: ${f.type}
  Current: ${f.currentValue}
  Options: ${f.options.join(', ')}
  Required: ${f.required}
`).join('\n')}

INSTRUCTIONS:
1. Understand the SECTION CONTEXT (Work Experience vs Home Address vs Education)
2. Match user profile to context-appropriate values
3. For each field, provide answer and confidence (HIGH/MEDIUM/LOW)
4. If uncertain, respond "SKIP"
5. Return JSON array with { label, answer, confidence, reasoning }`;
}
```

### Step 3️⃣: Update Injector to Use Agentic Functions

**File**: `engine/injector.js`

**What to inject**:
Instead of `FormFiller._scanFormFields()`, inject:

- `snapshotFormFields()` (from your script)
- `applyAnswers()` (from your script)
- `scanValidationErrors()` (from your script)
- `getFieldLabel()`, `getSectionContext()`, etc. (helpers)

These will run in the **webpage context** (not Node.js), so they can directly manipulate DOM.

### Step 4️⃣: Update Apply Loop

**File**: `engine/apply-loop.js`

**Change**:

```javascript
// OLD:
const formFiller = new FormFiller(fieldMap, this.aiService);

// NEW:
const agenticFiller = new AgenticFormFiller(this.aiService);

// OLD:
const result = await this.formFiller.fillForm(page, jobContext, profile);

// NEW:
const result = await this.agenticFiller.fillForm(
  this.page,
  jobContext,
  profile,
);
```

---

## Part 4: AI Prompt Engineering

### Current Prompt (BAD)

```javascript
// Treats each field independently - no context
"Please answer this question: " + field.label;
```

### New Prompt (GOOD)

```javascript
`You are an intelligent job application assistant filling forms for: ${jobContext.title}

FORM STRUCTURE:
${fields
  .map(
    (f) => `
[${f.sectionContext}]
${f.label}${f.required ? " *REQUIRED*" : ""}
Type: ${f.type}
Options: ${f.options.join(" | ")}
`,
  )
  .join("\n")}

USER PROFILE:
Name: ${profile.firstName} ${profile.lastName}
Email: ${profile.email}
Phone: ${profile.phone}
Home: ${profile.homeCity}, ${profile.homeState}
Education: ${profile.education}
Experience: ${profile.experience}

TASK: Fill each field with the MOST APPROPRIATE value from the user profile.

CRITICAL RULES:
1. "Work Experience > City" → Use job location OR company location, NOT home city
2. "Home Address > City" → Use home city
3. "Number of Years" → Calculate from dates, not use literal values
4. Never make up values - use ONLY provided profile data
5. If field doesn't match profile, respond "SKIP"

RESPOND WITH JSON ARRAY:
[
  { label: "Work Experience #1 > Company", answer: "Google", confidence: "HIGH" },
  { label: "Home Address > City", answer: "New York", confidence: "HIGH" },
  { label: "Unknown Field", answer: "SKIP", confidence: "LOW", reason: "No profile data matches" }
]`;
```

---

## Part 5: Testing Strategy

### Test Case #1: Multiple Cities (THE KEY TEST)

Set up a form with:

- Work Experience City field
- Home Address City field
- Education City field

**Old system**: All get `userProfile.homeCity` → **FAIL**

**New system**: Each gets correct city based on section → **PASS**

### Test Case #2: Validation Error Correction

1. Fill form with invalid email
2. Form shows red border + error message
3. System detects error
4. AI suggests correction
5. Error disappears → **PASS**

### Test Case #3: Custom Widgets

Test on LinkedIn/Internshala with:

- ARIA dropdowns (not `<select>`)
- Typeahead inputs
- Custom radio button groups

---

## Part 6: Files to Keep vs Replace

### ✅ KEEP (Already Good)

- `main.js` - Main Electron process
- `preload.js` - Preload injection
- `profile-store.js` - Profile storage
- `job-navigator.js` - Job discovery (mostly good, just needs section context usage)
- `ai-service.js` - Add batch processing methods, keep existing fallbacks

### ❌ REPLACE

- `form-filler.js` → `agentic-form-filler.js`
- Remove all static field mapping logic
- Remove hardcoded selector lists

### 📝 UPDATE

- `injector.js` - Inject the DOM snapshot functions
- `apply-loop.js` - Use new AgenticFormFiller
- `ai-service.js` - Add `answerQuestionsAgentic()` method

---

## Part 7: Configuration Needed

### Add to Settings

```json
{
  "agenticAI": {
    "maxCorrectionIterations": 2,
    "validationWaitMs": 1500,
    "batchProcessing": true,
    "confidenceThreshold": "MEDIUM",
    "debugMode": true,
    "logSectionDetection": true,
    "logAIPrompt": false
  }
}
```

---

## Summary: The 3-Step Fix

| Step               | Current                          | Needed                                         |
| ------------------ | -------------------------------- | ---------------------------------------------- |
| **1. Read Fields** | `_scanFormFields()` (no context) | `snapshotFormFields()` (with section + labels) |
| **2. Get Answers** | 1 AI call per field              | 1 AI call for ALL fields (batch)               |
| **3. Validate**    | (doesn't exist)                  | Scan errors + correction loop                  |

Once these 3 changes are made, your system will:
✅ Understand "Work Experience City" ≠ "Home City"
✅ Work on ANY website (no hardcoded selectors)
✅ Self-correct when validation fails
✅ Run 20x faster (1 AI call instead of 20)
✅ Cost 20x less (fewer API calls)

---

## Next Steps

1. Read the provided `AgenticFiller` script you found - it has 90% of the implementation
2. Extract its DOM snapshot functions into `engine/injector.js`
3. Create new `AgenticFormFiller` class
4. Update AIService with batch method
5. Test on a form with multiple cities (validation test)
