/**
 * Comprehensive test to verify form field detection and types
 * Run this on Turing form after page loads
 */

(async () => {
  const report = {
    timestamp: new Date().toISOString(),
    totalCards: 0,
    fieldsByType: {},
    detailedFields: [],
  };

  const cards = document.querySelectorAll('[data-slot="card"]');
  report.totalCards = cards.length;

  console.log(`🔍 FORM ANALYSIS ON ${cards.length} CARDS\n`);

  cards.forEach((card, idx) => {
    // Extract card title
    const titleEl = card.querySelector('[data-slot="card-title"]');
    const title = titleEl ? titleEl.textContent.trim() : `Card ${idx}`;

    console.log(`\n📌 Card ${idx + 1}: "${title}"`);

    const fieldInfo = {
      cardIndex: idx,
      label: title,
      elements: [],
    };

    // Check for textarea
    const textarea = card.querySelector("textarea");
    if (textarea) {
      fieldInfo.elements.push({
        type: "TEXTAREA",
        selector: "textarea",
        value: textarea.value?.substring(0, 50),
        placeholder: textarea.placeholder,
      });
      console.log(`  ✓ TEXTAREA`);
    }

    // Check for radio group
    const radioGroup = card.querySelector('[role="radiogroup"]');
    if (radioGroup) {
      const radios = radioGroup.querySelectorAll('[role="radio"]');
      const options = [];
      radios.forEach((r) => {
        const label = r.nextElementSibling?.textContent?.trim();
        if (label) options.push(label);
      });
      fieldInfo.elements.push({
        type: "RADIX_RADIO",
        selector: '[role="radiogroup"]',
        optionCount: options.length,
        options: options,
      });
      console.log(
        `  ✓ RADIO GROUP (${options.length} options): ${options.join(", ")}`,
      );
    }

    // Check for checkbox
    const checkbox = card.querySelector('[role="checkbox"]');
    if (checkbox) {
      const label = checkbox.nextElementSibling?.textContent?.trim();
      fieldInfo.elements.push({
        type: "RADIX_CHECKBOX",
        selector: '[role="checkbox"]',
        label: label,
        checked: checkbox.getAttribute("aria-checked") === "true",
      });
      console.log(
        `  ✓ CHECKBOX: "${label}" (checked: ${checkbox.getAttribute("aria-checked")})`,
      );
    }

    // Check for combobox
    const combobox = card.querySelector('[role="combobox"]');
    if (combobox) {
      fieldInfo.elements.push({
        type: "RADIX_COMBOBOX",
        selector: '[role="combobox"]',
        value: combobox.textContent?.substring(0, 50),
      });
      console.log(
        `  ✓ COMBOBOX: "${combobox.textContent?.trim().substring(0, 30)}..."`,
      );
    }

    // Check for text input
    const input = card.querySelector(
      'input[type="text"], input[type="email"], input[type="url"]',
    );
    if (input) {
      fieldInfo.elements.push({
        type: "INPUT_" + input.type.toUpperCase(),
        selector: `input[type="${input.type}"]`,
        value: input.value,
        name: input.name,
      });
      console.log(`  ✓ ${input.type.toUpperCase()}: "${input.value}"`);
    }

    if (fieldInfo.elements.length === 0) {
      console.log(`  ℹ️  No fillable elements`);
    }

    report.detailedFields.push(fieldInfo);

    // Track by type
    fieldInfo.elements.forEach((el) => {
      report.fieldsByType[el.type] = (report.fieldsByType[el.type] || 0) + 1;
    });
  });

  console.log(`\n📊 SUMMARY`);
  console.log(`Total Cards: ${report.totalCards}`);
  console.log(`Field Types Found:`);
  Object.entries(report.fieldsByType).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });

  console.log(`\n📋 FULL REPORT:`);
  console.log(JSON.stringify(report, null, 2));

  return report;
})();
