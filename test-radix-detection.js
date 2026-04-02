/**
 * Test script to diagnose form field detection
 * Run this in the browser console on the Turing form page
 */

(async () => {
  const diagnostics = {
    standardInputs: [],
    radioGroups: [],
    checkboxes: [],
    comboboxes: [],
    textareas: [],
    allFields: [],
  };

  // 1. Find standard inputs
  const standardInputs = document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="url"]',
  );
  standardInputs.forEach((el) => {
    const label =
      el.previousElementSibling?.textContent || el.placeholder || el.id;
    diagnostics.standardInputs.push({
      label,
      type: el.type,
      name: el.name,
      value: el.value,
    });
  });

  // 2. Find Radix radio groups
  const radioGroups = document.querySelectorAll('[role="radiogroup"]');
  radioGroups.forEach((group, idx) => {
    const card = group.closest('[data-slot="card"]');
    const cardTitle = card
      ?.querySelector('[data-slot="card-title"]')
      ?.textContent?.trim();
    const radios = group.querySelectorAll('[role="radio"]');
    const options = [];

    radios.forEach((radio) => {
      const label = radio.nextElementSibling?.textContent?.trim();
      if (label) options.push(label);
    });

    diagnostics.radioGroups.push({
      label: cardTitle,
      optionCount: options.length,
      options,
    });
  });

  // 3. Find Radix checkboxes
  const checkboxes = document.querySelectorAll('[role="checkbox"]');
  checkboxes.forEach((cb) => {
    const label = cb.nextElementSibling?.textContent?.trim();
    diagnostics.checkboxes.push({
      label,
      checked: cb.getAttribute("aria-checked") === "true",
    });
  });

  // 4. Find comboboxes
  const comboboxes = document.querySelectorAll('[role="combobox"]');
  comboboxes.forEach((cb) => {
    const card = cb.closest('[data-slot="card"]');
    const cardTitle = card
      ?.querySelector('[data-slot="card-title"]')
      ?.textContent?.trim();
    diagnostics.comboboxes.push({
      label: cardTitle,
      value: cb.textContent?.trim(),
    });
  });

  // 5. Find textareas
  const textareas = document.querySelectorAll("textarea");
  textareas.forEach((ta) => {
    const card = ta.closest('[data-slot="card"]');
    const cardTitle = card
      ?.querySelector('[data-slot="card-title"]')
      ?.textContent?.trim();
    diagnostics.textareas.push({
      label: cardTitle,
      placeholder: ta.placeholder,
      value: ta.value?.substring(0, 50),
    });
  });

  // Summary
  diagnostics.allFields = [
    ...diagnostics.standardInputs,
    ...diagnostics.radioGroups,
    ...diagnostics.checkboxes,
    ...diagnostics.comboboxes,
    ...diagnostics.textareas,
  ];

  console.log("📋 FORM DETECTION DIAGNOSTICS");
  console.log("============================");
  console.log(`Total Fields Found: ${diagnostics.allFields.length}`);
  console.log(`  - Standard Inputs: ${diagnostics.standardInputs.length}`);
  console.log(`  - Radio Groups: ${diagnostics.radioGroups.length}`);
  console.log(`  - Checkboxes: ${diagnostics.checkboxes.length}`);
  console.log(`  - Comboboxes: ${diagnostics.comboboxes.length}`);
  console.log(`  - Textareas: ${diagnostics.textareas.length}`);
  console.log("");
  console.log("DETAILS:");
  console.log(JSON.stringify(diagnostics, null, 2));

  return diagnostics;
})();
