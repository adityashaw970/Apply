// ══════════════════════════════════════════════════════════
// MassApply — LinkedIn Easy Apply Injector (v2)
// Runs inside webview context on LinkedIn pages
// Fixed: Real LinkedIn DOM selectors, plain-text job desc,
//        review loop protection, improved AI integration
// ══════════════════════════════════════════════════════════

(function (FIELD_MAP, USER_PROFILE, OPTIONS) {
  "use strict";

  const ACTION = OPTIONS.action || "scanJobs";
  const JOB_INDEX = OPTIONS.jobIndex || 0;
  const AI_ANSWERS = OPTIONS.aiAnswers || [];

  const result = {
    action: ACTION,
    success: false,
    data: null,
    error: null,
  };

  // ═══ HELPER: Check if a label is a work experience field ═══
  function isWorkExperienceField(label) {
    if (!label) return false;
    const l = label.toLowerCase();

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

    for (const indicator of strongWorkExperienceIndicators) {
      if (l.includes(indicator)) {
        return true;
      }
    }

    // Also check if label is asking about work-specific details
    if (
      l.includes("work") &&
      (l.includes("experience") ||
        l.includes("history") ||
        l.includes("employment"))
    ) {
      return true;
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
      if (indicator.test(l)) {
        return true;
      }
    }

    // CONTEXTUAL: Patterns that only appear in work experience
    if (l.includes("for ") && l.includes("company")) {
      return true;
    }

    if (l.includes("company you") || l.includes("company where")) {
      return true;
    }
    return false;
  }

  // ═══ HELPER: Set value with React/Ember-compatible events ═══
  function safeSetValue(el, value) {
        console.log(
          `[safeSetValue] Setting input to: "${value}"`,
          el.id || el.className,
        );

        // Strategy 1: focus + React setter
        el.focus();
        try {
          const proto =
            el.tagName === "TEXTAREA"
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (setter) setter.call(el, value);
          else el.value = value;
        } catch (e) {
          el.value = value;
        }

        // Strategy 2: User interaction events (Mouse + Keyboard)
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const mouseOpts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
        };
        el.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
        el.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
        el.dispatchEvent(new MouseEvent("click", mouseOpts));

        el.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
        );
        el.dispatchEvent(
          new KeyboardEvent("keypress", { bubbles: true, key: "Enter" }),
        );
        el.dispatchEvent(
          new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }),
        );

        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));

        // Strategy 3: React fiber internal onChange
        try {
          const fiberKey = Object.keys(el).find(
            (k) =>
              k.startsWith("__reactFiber") ||
              k.startsWith("__reactInternalInstance") ||
              k.startsWith("__reactEventHandlers") ||
              k.startsWith("_reactFiber"),
          );
          if (fiberKey) {
            const fiber = el[fiberKey];
            const props = fiber?.memoizedProps || fiber?.pendingProps;
            if (props?.onChange) {
              props.onChange({ target: el, currentTarget: el, bubbles: true });
            }
          }
        } catch (e) {
          /* ignore */
        }

        // Strategy 4: Ember-specific change event
        try {
          const changeEvent = new Event("change", {
            bubbles: true,
            cancelable: false,
          });
          Object.defineProperty(changeEvent, "target", {
            value: el,
            writable: false,
          });
          el.dispatchEvent(changeEvent);
        } catch (e) {
          /* ignore */
        }
      }

      // ═══ HELPER: Set select value — multi-strategy for React/Ember/LinkedIn ═══
      // LinkedIn uses Ember.js. Direct .value assignment is ignored by Ember's bindings.
      // We try multiple strategies in order:
      //   1. selectedIndex assignment (more direct than .value for Ember)
      //   2. Native HTMLSelectElement prototype setter (for React if present)
      //   3. Simulate user interaction: focus + keyboard events
      //   4. React fiber internal onChange hook
      function safeSetSelectValue(selectEl, value) {
        console.log(
          `[safeSetSelectValue] Setting select to: "${value}"`,
          selectEl.id || selectEl.className,
        );

        // Find the target option index
        const opts = Array.from(selectEl.options);
        const targetIdx = opts.findIndex(
          (o) =>
            o.value === value ||
            o.text.trim() === value ||
            o.value.toLowerCase() === value.toLowerCase() ||
            o.text.trim().toLowerCase() === value.toLowerCase(),
        );

        if (targetIdx === -1) {
          console.warn(`[safeSetSelectValue] Option not found: "${value}"`);
          return;
        }

        // Strategy 1: Set selectedIndex (Ember watches index changes)
        selectEl.selectedIndex = targetIdx;
        selectEl.options[targetIdx].selected = true;

        // Strategy 2: Native setter (for React)
        try {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            "value",
          )?.set;
          if (nativeSetter) nativeSetter.call(selectEl, value);
          else selectEl.value = value;
        } catch (e) {
          selectEl.value = value;
        }

        // Strategy 3: Focus + simulated user interaction events
        selectEl.focus();
        selectEl.dispatchEvent(new Event("focus", { bubbles: true }));
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        selectEl.dispatchEvent(new Event("blur", { bubbles: true }));

        // Also simulate mouse interaction on the select
        const rect = selectEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const mouseOpts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
        };
        selectEl.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
        selectEl.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
        selectEl.dispatchEvent(new MouseEvent("click", mouseOpts));

        // Strategy 4: React fiber internal onChange
        try {
          const fiberKey = Object.keys(selectEl).find(
            (k) =>
              k.startsWith("__reactFiber") ||
              k.startsWith("__reactInternalInstance") ||
              k.startsWith("__reactEventHandlers") ||
              k.startsWith("_reactFiber"),
          );
          if (fiberKey) {
            const fiber = selectEl[fiberKey];
            const props = fiber?.memoizedProps || fiber?.pendingProps;
            if (props?.onChange) {
              props.onChange({
                target: selectEl,
                currentTarget: selectEl,
                bubbles: true,
              });
            }
          }
        } catch (e) {
          /* ignore React fiber errors */
        }

        // Strategy 5: Ember-specific — trigger Ember's run loop via a bubbling change event
        // by firing it on the document as well
        try {
          const changeEvent = new Event("change", {
            bubbles: true,
            cancelable: false,
          });
          Object.defineProperty(changeEvent, "target", {
            value: selectEl,
            writable: false,
          });
          selectEl.dispatchEvent(changeEvent);
        } catch (e) {
          /* ignore */
        }

        console.log(
          `[safeSetSelectValue] Done. Final value: "${selectEl.value}" (index: ${selectEl.selectedIndex})`,
        );
      }

      // ═══ HELPER: Check element visibility (supports display:contents) ═══
      function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        try {
          const style = window.getComputedStyle(el);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return false;
          }
        } catch (e) {}
        return true;
      }

      // ═══ HELPER: Find the active Easy Apply modal ═══
      // Checks the main document AND any same-origin iframes.
      // LinkedIn's Easy Apply modal is sometimes rendered inside an iframe
      // overlay — document.querySelector() in the main frame cannot pierce
      // iframe boundaries, which is why dialogs/header counts appear as 0
      // even when the modal is visually on screen.
      function getEasyApplyModal() {
        function findInDoc(doc) {
          if (!doc) return null;
          try {
            // Strategy 1: Walk up from #jobs-apply-header (most reliable)
            var hdr = doc.querySelector("#jobs-apply-header");
            if (hdr) {
              var m = hdr.closest(".jobs-easy-apply-modal") ||
                      hdr.closest("[data-test-modal]") ||
                      hdr.closest('[role="dialog"]') ||
                      hdr.closest(".artdeco-modal") ||
                      hdr.closest("[data-test-modal-id='easy-apply-modal']");
              if (m) return m;
              // Fallback: return closest form or section when no modal wrapper exists
              // (full-page apply form scenario)
              var fb = doc.querySelector("form") ||
                       doc.querySelector(".jobs-easy-apply-content") ||
                       hdr.closest("section, main, article") ||
                       hdr.parentElement;
              if (fb) return fb;
            }
            // Strategy 2: Direct modal class
            var byClass = doc.querySelector(".jobs-easy-apply-modal");
            if (byClass) return byClass;
            // Strategy 3: Test-id on overlay container
            var ov = doc.querySelector("[data-test-modal-id='easy-apply-modal']");
            if (ov) return ov.querySelector('[role="dialog"]') || ov.querySelector(".artdeco-modal") || ov;
            // Strategy 4: aria-labelledby
            var byLabel = doc.querySelector('[aria-labelledby="jobs-apply-header"]');
            if (byLabel) return byLabel;
            // Strategy 5: Any dialog containing EA form/button
            var dlgs = Array.from(doc.querySelectorAll('[role="dialog"]'));
            for (var i = 0; i < dlgs.length; i++) {
              if (dlgs[i].querySelector("form, [data-easy-apply-next-button], [data-live-test-easy-apply-submit-button], .jobs-easy-apply-modal__content")) {
                return dlgs[i];
              }
            }
            // Strategy 6: [data-test-modal] with a form
            var tms = Array.from(doc.querySelectorAll("[data-test-modal]"));
            for (var j = 0; j < tms.length; j++) {
              if (tms[j].querySelector("form")) return tms[j];
            }
          } catch(e) {}
          return null;
        }

        // 1. Check main document
        var mainResult = findInDoc(document);
        if (mainResult) return mainResult;

        // 2. Check same-origin iframes (LinkedIn uses iframe overlays for the apply form)
        try {
          var iframes = document.querySelectorAll("iframe");
          for (var k = 0; k < iframes.length; k++) {
            try {
              var iDoc = iframes[k].contentDocument ||
                        (iframes[k].contentWindow && iframes[k].contentWindow.document);
              var iResult = findInDoc(iDoc);
              if (iResult) {
                console.log("[getEasyApplyModal] Found in iframe:", iframes[k].src || "(no src)");
                return iResult;
              }
            } catch(e) { /* cross-origin iframe — skip */ }
          }
        } catch(e) {}

        return null;
      }


      // ═══ HELPER: Click with full event sequence (nav-safe for <a> links) ═══
      function realClick(el) {
        if (!el) return;
        try {
          el.scrollIntoView({ behavior: "instant", block: "center" });
        } catch (e) {}

        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
          button: 0,
        };

        const linkEl = el.tagName === "A" ? el : el.closest("a");
        if (linkEl) {
          // Intercept default browser URL navigation on links
          const preventNav = (e) => {
            e.preventDefault();
          };
          linkEl.addEventListener("click", preventNav, { once: true });
        }

        el.dispatchEvent(new MouseEvent("pointerdown", opts));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new MouseEvent("pointerup", opts));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));

        if (!linkEl) {
          try {
            el.click();
          } catch (e) {}
        }
      }

      // ═══ HELPER: Extract clean plain text from an element (strip HTML) ═══
      function plainText(el) {
        if (!el) return "";
        // Clone to avoid mutating the page, strip scripts/styles
        const clone = el.cloneNode(true);
        clone
          .querySelectorAll('script, style, svg, img, button, [role="img"]')
          .forEach((n) => n.remove());
        // Convert <br>, <p>, <div> to newlines for readability
        let html = clone.innerHTML || "";
        html = html.replace(/<br\s*\/?>/gi, "\n");
        html = html.replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
        html = html.replace(/<[^>]+>/g, " ");
        // Decode HTML entities
        const txt = document.createElement("textarea");
        txt.innerHTML = html;
        return txt.value
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }

      function getGroupLabel(group) {
        // Check legend first (checkbox/radio fieldsets use <legend> not <label>)
        const legendEl = group.querySelector("legend");
        if (legendEl) {
          const ariaHidden = legendEl.querySelector('span[aria-hidden="true"]');
          if (ariaHidden && ariaHidden.textContent.trim()) {
            return ariaHidden.textContent.trim().replace(/\s+/g, " ");
          }
          const clone = legendEl.cloneNode(true);
          clone.querySelectorAll(".visually-hidden").forEach((n) => n.remove());
          const text = clone.textContent.trim().replace(/\s+/g, " ");
          if (text) return text;
        }

        const labelSelectors = [
          "label",
          ".fb-dash-form-element__label",
          ".artdeco-text-input--label",
          "[data-test-form-element-label]",
          ".t-14.t-bold",
          ".jobs-easy-apply-form-element__label",
          "span.t-bold",
          ".t-16.t-bold",
        ];

        for (const sel of labelSelectors) {
          const lbl = group.querySelector(sel);
          if (lbl && lbl.textContent.trim()) {
            const ariaHiddenSpan = lbl.querySelector(
              'span[aria-hidden="true"]',
            );
            if (ariaHiddenSpan && ariaHiddenSpan.textContent.trim()) {
              return ariaHiddenSpan.textContent.trim().replace(/\s+/g, " ");
            }
            const clone = lbl.cloneNode(true);
            clone
              .querySelectorAll('.visually-hidden, [aria-hidden="false"]')
              .forEach((n) => n.remove());
            const text = clone.textContent.trim().replace(/\s+/g, " ");
            if (text) return text;
            return lbl.textContent.trim().replace(/\s+/g, " ");
          }
        }

        // Fallback: find label via for→id association (fixes LinkedIn field)
        const inputEl = group.querySelector(
          "input[id], select[id], textarea[id]",
        );
        if (inputEl && inputEl.id) {
          const associated = document.querySelector(
            `label[for="${CSS.escape(inputEl.id)}"]`,
          );
          if (associated) {
            const ariaHidden = associated.querySelector(
              'span[aria-hidden="true"]',
            );
            if (ariaHidden && ariaHidden.textContent.trim())
              return ariaHidden.textContent.trim();
            return associated.textContent.trim().replace(/\s+/g, " ");
          }
        }

        const input = group.querySelector("input, select, textarea");
        if (input) {
          return (
            input.getAttribute("aria-label") ||
            input.getAttribute("placeholder") ||
            input.name ||
            ""
          );
        }
        return "";
      }

      // ═══ HELPER: Check if field is required ═══
      function isRequired(group) {
        const requiredIndicator = group.querySelector(
          ".artdeco-text-input--required, [required], .required, .fb-dash-form-element__error-field",
        );
        const label = group.querySelector(
          "label, .fb-dash-form-element__label",
        );
        if (label && label.textContent.includes("*")) return true;
        if (requiredIndicator) return true;
        const input = group.querySelector("input, select, textarea");
        return (
          input?.required || input?.getAttribute("aria-required") === "true"
        );
      }

      // ═══ HELPER: Match field label to profile data ═══
      function matchToProfile(label) {
        if (!label) return null;
        const l = label
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, "")
          .trim();

        const mapping = {
          "first name":
            USER_PROFILE.firstName ||
            (USER_PROFILE.fullName || "").split(" ")[0],
          "last name":
            USER_PROFILE.lastName ||
            (USER_PROFILE.fullName || "").split(" ").slice(1).join(" "),
          "full name":
            USER_PROFILE.fullName ||
            `${USER_PROFILE.firstName || ""} ${USER_PROFILE.lastName || ""}`.trim(),
          email: USER_PROFILE.email,
          "email address": USER_PROFILE.email,
          phone: USER_PROFILE.phone,
          "phone number": USER_PROFILE.phone,
          mobile: USER_PROFILE.phone,
          "mobile number": USER_PROFILE.phone,
          "phone country code": USER_PROFILE.phoneCountryCode || USER_PROFILE.countryCode || "India (+91)",
          "country code": USER_PROFILE.phoneCountryCode || USER_PROFILE.countryCode || "India (+91)",
          city: USER_PROFILE.city,
          "current city": USER_PROFILE.city,
          location: USER_PROFILE.city,
          "current location": USER_PROFILE.city,
          state: USER_PROFILE.state,
          country: USER_PROFILE.country,
          zip: USER_PROFILE.pincode,
          "zip code": USER_PROFILE.pincode,
          "postal code": USER_PROFILE.pincode,
          pincode: USER_PROFILE.pincode,
          address: USER_PROFILE.address,
          "street address": USER_PROFILE.address,
          linkedin: USER_PROFILE.linkedinUrl,
          "linkedin url": USER_PROFILE.linkedinUrl,
          "linkedin profile": USER_PROFILE.linkedinUrl,
          github: USER_PROFILE.githubUrl,
          "github url": USER_PROFILE.githubUrl,
          portfolio: USER_PROFILE.portfolioUrl,
          "portfolio url": USER_PROFILE.portfolioUrl,
          website: USER_PROFILE.portfolioUrl,
          "personal website": USER_PROFILE.portfolioUrl,
          college: USER_PROFILE.collegeName,
          university: USER_PROFILE.university || USER_PROFILE.collegeName,
          degree: USER_PROFILE.degree,
          gpa: USER_PROFILE.cgpa,
          cgpa: USER_PROFILE.cgpa,
          "graduation year": USER_PROFILE.graduationYear,
          "year of graduation": USER_PROFILE.graduationYear,
          experience: USER_PROFILE.experience,
          "years of experience": USER_PROFILE.experience,
          "total experience": USER_PROFILE.experience,
          "current company": USER_PROFILE.currentCompany,
          "current employer": USER_PROFILE.currentCompany,
          "current role": USER_PROFILE.currentDesignation,
          "current title": USER_PROFILE.currentDesignation,
          designation: USER_PROFILE.currentDesignation,
          "job title": USER_PROFILE.currentDesignation,
          skills: USER_PROFILE.skills,
          salary: USER_PROFILE.expectedCTC,
          "expected salary": USER_PROFILE.expectedCTC,
          "expected ctc": USER_PROFILE.expectedCTC,
          "desired salary": USER_PROFILE.expectedCTC,
          compensation: USER_PROFILE.expectedCTC,
          "expected compensation": USER_PROFILE.expectedCTC,
          "expected comp": USER_PROFILE.expectedCTC,
          "current salary": USER_PROFILE.currentCTC,
          "current ctc": USER_PROFILE.currentCTC,
          "notice period": USER_PROFILE.noticePeriod,
          "cover letter": USER_PROFILE.coverLetter,
          summary: USER_PROFILE.aboutMe,
          about: USER_PROFILE.aboutMe,
          headline: USER_PROFILE.currentDesignation,
        };

        if (mapping[l] !== undefined && mapping[l]) return mapping[l];

        const sortedMapping = Object.entries(mapping).sort(
          (a, b) => b[0].length - a[0].length,
        );
        for (const [key, val] of sortedMapping) {
          if (val && (l.includes(key) || key.includes(l))) return val;
        }

        if (FIELD_MAP) {
          const sortedFieldMap = Object.entries(FIELD_MAP).sort(
            (a, b) => b[0].length - a[0].length,
          );
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
            const qLower = qa.question
              .toLowerCase()
              .replace(/[^a-z0-9\s]/g, "")
              .trim();
            if (l.includes(qLower) || qLower.includes(l) || l === qLower) {
              return qa.answer;
            }
          }
        }

        return null;
      }

      // ═══════════════════════════════════════════════════
      // ACTION: waitForModal — Wait (inside the page) for the
      // Easy Apply modal to appear. Checks main document AND
      // same-origin iframes. Returns a Promise which Electron
      // awaits automatically via executeJavaScript.
      // ═══════════════════════════════════════════════════
      if (ACTION === "waitForModal") {
        var maxWait = (OPTIONS.maxWait) || 20000;

        // Immediate check (covers the case where modal was already open)
        var immediateModal = getEasyApplyModal();
        if (immediateModal) {
          result.success = true;
          result.data = { found: true, waitedMs: 0, source: "immediate" };
          return JSON.stringify(result);
        }

        // Return a Promise — Electron's executeJavaScript awaits it automatically
        return new Promise(function(resolve) {
          var startTime = Date.now();
          var resolved = false;

          function finish(success, source) {
            if (resolved) return;
            resolved = true;
            try { mainObserver.disconnect(); } catch(e) {}
            clearInterval(pollId);
            clearTimeout(toutId);
            if (success) {
              resolve(JSON.stringify({
                action: ACTION, success: true, error: null,
                data: { found: true, waitedMs: Date.now() - startTime, source: source || "observer" }
              }));
            } else {
              // Detailed timeout diagnostic — includes iframe count
              var iframeCount = 0;
              var iframeHasHeader = false;
              try {
                var frs = document.querySelectorAll("iframe");
                iframeCount = frs.length;
                for (var fi = 0; fi < frs.length; fi++) {
                  try {
                    var fd = frs[fi].contentDocument;
                    if (fd && fd.querySelector("#jobs-apply-header, .jobs-easy-apply-modal")) {
                      iframeHasHeader = true;
                      break;
                    }
                  } catch(e) {}
                }
              } catch(e) {}
              resolve(JSON.stringify({
                action: ACTION, success: false, error: "MODAL_WAIT_TIMEOUT",
                data: {
                  dialogs: document.querySelectorAll('[role="dialog"]').length,
                  header: !!document.querySelector("#jobs-apply-header"),
                  eaModal: !!document.querySelector(".jobs-easy-apply-modal"),
                  iframes: iframeCount,
                  iframeHasModal: iframeHasHeader
                }
              }));
            }
          }

          // Helper to start observing an iframe's document
          function observeIframe(iframe) {
            try {
              var iDoc = iframe.contentDocument ||
                        (iframe.contentWindow && iframe.contentWindow.document);
              if (!iDoc) return;
              // Check immediately
              try {
                var iResult = (function findInDoc(doc) {
                  if (!doc) return null;
                  return doc.querySelector("#jobs-apply-header, .jobs-easy-apply-modal, [data-test-modal-id='easy-apply-modal'], [aria-labelledby='jobs-apply-header']");
                })(iDoc);
                if (iResult) { finish(true, "iframe-immediate"); return; }
              } catch(e) {}
              // Observe mutations inside this iframe
              try {
                mainObserver.observe(iDoc, { childList: true, subtree: true });
              } catch(e) {}
            } catch(e) {}
          }

          // Main MutationObserver watches BOTH the main document AND iframes
          var mainObserver = new MutationObserver(function(mutations) {
            // First check if modal now exists
            if (getEasyApplyModal()) { finish(true, "mutation"); return; }
            // Also watch any newly added iframes
            for (var mi = 0; mi < mutations.length; mi++) {
              var added = mutations[mi].addedNodes;
              for (var ai = 0; ai < added.length; ai++) {
                var node = added[ai];
                if (!node || node.nodeType !== 1) continue;
                if (node.tagName === "IFRAME") {
                  node.addEventListener("load", function() { observeIframe(node); });
                  observeIframe(node); // check immediately if already loaded
                } else {
                  // Check for iframes nested inside newly added nodes
                  try {
                    var nested = node.querySelectorAll("iframe");
                    for (var ni = 0; ni < nested.length; ni++) {
                      nested[ni].addEventListener("load", (function(f) { return function() { observeIframe(f); }; })(nested[ni]));
                      observeIframe(nested[ni]);
                    }
                  } catch(e) {}
                }
              }
            }
          });

          // Observe main document
          mainObserver.observe(document.documentElement, { childList: true, subtree: true });

          // Also observe any iframes that already exist in the page
          try {
            var existingFrames = document.querySelectorAll("iframe");
            for (var efi = 0; efi < existingFrames.length; efi++) {
              var ef = existingFrames[efi];
              if (ef.contentDocument && ef.contentDocument.readyState !== "loading") {
                observeIframe(ef);
              } else {
                ef.addEventListener("load", (function(f) { return function() { observeIframe(f); }; })(ef));
              }
            }
          } catch(e) {}

          // Polling fallback every 400ms (catches edge cases the observer misses)
          var pollId = setInterval(function() {
            if (getEasyApplyModal()) finish(true, "poll");
          }, 400);

          var toutId = setTimeout(function() { finish(false); }, maxWait);
        });
      }

      // ═══════════════════════════════════════════════════
      // ACTION: scanJobs — Find all job cards on search page

      // Uses REAL LinkedIn selectors from 2025 DOM
      // ═══════════════════════════════════════════════════
      if (ACTION === "scanJobs") {
        const jobs = [];

        // Support both new componentkey DOM layout and legacy data-occludable-job-id layout
        const cardSelectors = [
          '[componentkey^="job-card-component-ref-"]',
          "div[componentkey^=\"job-card-component-ref-\"]",
          "[data-occludable-job-id]",
          "div.job-card-job-posting-card-wrapper[data-job-id]",
          ".job-card-container[data-job-id]",
          "li.ember-view.occludable-update",
        ];

        let cards = [];
        let usedSelector = "";
        for (const sel of cardSelectors) {
          cards = document.querySelectorAll(sel);
          if (cards.length > 0) {
            usedSelector = sel;
            break;
          }
        }

        cards.forEach((card, idx) => {
          // Get the stable job ID from componentkey or data attribute
          let jobId =
            card.getAttribute("data-occludable-job-id") ||
            card.getAttribute("data-job-id") ||
            "";

          if (!jobId) {
            const compKey = card.getAttribute("componentkey") || "";
            const match = compKey.match(/job-card-component-ref-(\d+)/);
            if (match) {
              jobId = match[1];
            }
          }

          let title = "";
          let company = "";
          let location = "";

          // Check if this card uses the new LinkedIn component-key DOM layout
          const isNewDomCard =
            card.hasAttribute("componentkey") &&
            card.getAttribute("componentkey").includes("job-card-component-ref-");

          if (isNewDomCard) {
            const paragraphs = Array.from(card.querySelectorAll("p"));

            // Title: first paragraph or paragraph containing _83f69eb5 / aria-hidden title span
            const titleSpan = card.querySelector(
              'p span._83f69eb5, p span[aria-hidden="true"]',
            );
            if (titleSpan) {
              const clone = titleSpan.cloneNode(true);
              clone.querySelectorAll("svg, button, [role='img']").forEach((el) => el.remove());
              title = clone.textContent.trim().replace(/\s+/g, " ");
            } else if (paragraphs[0]) {
              const clone = paragraphs[0].cloneNode(true);
              clone.querySelectorAll("svg, button, [role='img']").forEach((el) => el.remove());
              title = clone.textContent.trim().replace(/\s+/g, " ");
            }

            // Company: inside div.b4f30b99 or 2nd paragraph
            const companyP =
              card.querySelector(".b4f30b99 p") ||
              (paragraphs[1] &&
              paragraphs[1] !== card.querySelector('p span._83f69eb5')?.closest('p')
                ? paragraphs[1]
                : null);
            if (companyP) {
              const clone = companyP.cloneNode(true);
              clone.querySelectorAll("svg").forEach((el) => el.remove());
              company = clone.textContent.trim().replace(/\s+/g, " ");
            }

            // Location: paragraph following company paragraph
            for (let i = 1; i < paragraphs.length; i++) {
              const p = paragraphs[i];
              const txt = p.textContent.trim().replace(/\s+/g, " ");
              if (
                txt &&
                txt !== company &&
                !/^(Viewed|Posted|Easy Apply|\d+ (days|weeks|months|hours) ago|Actively reviewing|.*alumni work here)$/i.test(
                  txt,
                ) &&
                !txt.includes("Easy Apply")
              ) {
                location = txt;
                break;
              }
            }
          }

          // Fallback title extraction for legacy DOM structures
          if (!title) {
            const titleEl = card.querySelector(
              '.job-card-job-posting-card-wrapper__title span[aria-hidden="true"] strong, ' +
                '.artdeco-entity-lockup__title span[aria-hidden="true"] strong, ' +
                '.artdeco-entity-lockup__title span[aria-hidden="true"], ' +
                ".artdeco-entity-lockup__title a, " +
                ".job-card-list__title, " +
                "a.job-card-container__link",
            );
            if (titleEl) {
              const ariaHiddenSpan = titleEl.querySelector('span[aria-hidden="true"]');
              title = (ariaHiddenSpan || titleEl).textContent.trim().replace(/\s+/g, " ");
            }
          }
          if (!title) {
            title = `Job ${idx + 1}`;
          }

          // Fallback company extraction for legacy DOM structures
          if (!company) {
            const companyEl = card.querySelector(
              ".artdeco-entity-lockup__subtitle span, " +
                ".artdeco-entity-lockup__subtitle div, " +
                ".artdeco-entity-lockup__subtitle, " +
                ".job-card-container__primary-description, " +
                ".job-card-container__company-name",
            );
            if (companyEl) {
              const ariaHiddenSpan = companyEl.querySelector('span[aria-hidden="true"]');
              company = (ariaHiddenSpan || companyEl).textContent.trim().replace(/\s+/g, " ");
            }
          }

          // Fallback location extraction for legacy DOM structures
          if (!location) {
            const locationEl = card.querySelector(
              ".artdeco-entity-lockup__caption li span, " +
                ".artdeco-entity-lockup__caption div, " +
                ".artdeco-entity-lockup__caption, " +
                ".job-card-container__metadata-item",
            );
            if (locationEl) {
              location = locationEl.textContent.trim().replace(/\s+/g, " ");
            }
          }

          const fullCardText = card.textContent || "";

          // Check for Easy Apply
          const isEasyApply =
            /Easy Apply/i.test(fullCardText) ||
            !!card.querySelector("#linkedin-bug-small");

          // Check footer for "Applied" / "Easy Apply"
          const footerItems = card.querySelectorAll(
            ".job-card-container__footer-item, " +
              ".job-card-list__footer-wrapper li",
          );
          let isApplied = false;
          footerItems.forEach((fi) => {
            const txt = fi.textContent.trim().toLowerCase();
            if (txt === "applied") isApplied = true;
          });

          if (!isApplied) {
            const appliedBadge = card.querySelector(
              ".job-card-container__footer-item--applied, .artdeco-inline-feedback--success",
            );
            isApplied = !!appliedBadge;
          }

          const boldFooterItem = card.querySelector(
            ".job-card-container__footer-item.t-bold",
          );
          if (
            boldFooterItem &&
            boldFooterItem.textContent.trim().toLowerCase() === "applied"
          ) {
            isApplied = true;
          }

          if (!isApplied) {
            const textWithoutEasyApply = fullCardText.replace(/Easy Apply/gi, "");
            if (/\bApplied\b/i.test(textWithoutEasyApply)) {
              isApplied = true;
            }
          }

          jobs.push({
            index: idx,
            jobId,
            title,
            company,
            location,
            isApplied,
            isEasyApply,
          });
        });

        result.success = true;
        result.data = {
          jobs,
          totalCards: cards.length,
          selector: usedSelector,
        };
      }

      // ═══════════════════════════════════════════════════
      // ACTION: clickJob — Click a specific job card
      // LinkedIn updated DOM: <a> tags are marked "disabled"
      // Must click the card div or strong title text, NOT the <a> link
      // ═══════════════════════════════════════════════════
      else if (ACTION === "clickJob") {
        const JOB_ID = OPTIONS.jobId || "";

        // Primary: find card by componentkey or stable data attributes
        let card = null;
        if (JOB_ID) {
          card =
            document.querySelector(`[componentkey="job-card-component-ref-${JOB_ID}"]`) ||
            document.querySelector(`[data-occludable-job-id="${JOB_ID}"]`) ||
            document.querySelector(`div.job-card-job-posting-card-wrapper[data-job-id="${JOB_ID}"]`) ||
            document.querySelector(`[data-job-id="${JOB_ID}"]`);
        }

        // Fallback: find by index
        if (!card) {
          const fallbackSelectors = [
            '[componentkey^="job-card-component-ref-"]',
            "[data-occludable-job-id]",
            "div.job-card-job-posting-card-wrapper[data-job-id]",
            ".job-card-container[data-job-id]",
            "li.ember-view.occludable-update",
          ];
          let cards = [];
          for (const sel of fallbackSelectors) {
            cards = document.querySelectorAll(sel);
            if (cards.length > 0) break;
          }
          card = cards[JOB_INDEX];
        }

        if (card) {
          // Find interactive click target
          let clickTarget =
            card.querySelector('[role="button"]') ||
            card.querySelector("div.job-card-container") ||
            card.querySelector(
              '.artdeco-entity-lockup__title span[aria-hidden="true"] strong, ' +
                '.job-card-job-posting-card-wrapper__title span[aria-hidden="true"] strong',
            ) ||
            card.querySelector(
              '.artdeco-entity-lockup__title span[aria-hidden="true"], ' +
                '.job-card-job-posting-card-wrapper__title span[aria-hidden="true"], ' +
                'p span._83f69eb5',
            ) ||
            card;

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
      else if (ACTION === "clickEasyApply") {
        const checkBtn = (b) => {
          if (!b || !isVisible(b)) return false;
          const text = (b.textContent || "").trim().toLowerCase();
          const ariaLabel = (b.getAttribute("aria-label") || "").toLowerCase();
          const href = (b.getAttribute("href") || "").toLowerCase();
          return (
            text.includes("easy apply") ||
            ariaLabel.includes("easy apply") ||
            href.includes("opensduiapplyflow=true")
          );
        };

        let btn = null;

        // Strategy 1: Exact ID button
        const idBtn = document.querySelector("#jobs-apply-button-id");
        if (checkBtn(idBtn)) {
          btn = idBtn;
        }

        // Strategy 2: Targeted selectors (supporting both <button> and <a> tags)
        if (!btn) {
          const easyApplySelectors = [
            "a[aria-label*='Easy Apply']",
            "a[aria-label*='Easy apply']",
            "button[aria-label*='Easy Apply']",
            "button[aria-label*='Easy apply']",
            "a[href*='openSDUIApplyFlow=true']",
            "a[href*='/apply/']",
            ".jobs-apply-button--top-card button",
            ".jobs-apply-button--top-card a",
            "button.jobs-apply-button",
            "a.jobs-apply-button",
            ".jobs-apply-button--top-card .artdeco-button--primary",
            ".jobs-s-apply button",
            ".jobs-s-apply a",
            "button.jobs-apply-button.artdeco-button--primary",
            "[data-job-search-apply-button]",
            "[data-easy-apply-button]",
            ".jobs-unified-top-card button",
            ".jobs-unified-top-card a",
            ".jobs-details-top-card button",
            ".jobs-details-top-card a",
            ".job-details-jobs-unified-top-card__container button",
            ".job-details-jobs-unified-top-card__container a",
          ];

          for (const sel of easyApplySelectors) {
            const candidates = document.querySelectorAll(sel);
            for (const candidate of candidates) {
              if (checkBtn(candidate)) {
                btn = candidate;
                break;
              }
            }
            if (btn) break;
          }
        }

        // Strategy 3: Any visible button, link, or role="button" containing "Easy Apply"
        if (!btn) {
          const allBtns = document.querySelectorAll(
            "button, a, [role='button'], [aria-label*='Easy Apply'], [aria-label*='Easy apply']",
          );
          for (const b of allBtns) {
            if (checkBtn(b)) {
              btn = b;
              break;
            }
          }
        }

        if (btn) {
          realClick(btn);
          result.success = true;
          result.data = { isEasyApply: true };
        } else {
          const appliedEl = document.querySelector(
            ".jobs-apply-button--applied, .artdeco-inline-feedback--success, [data-test-icon='check-small']",
          );
          const applyBtn = document.querySelector("button.jobs-apply-button, #jobs-apply-button-id");
          const applyBtnText = (applyBtn?.textContent || "").toLowerCase();

          if (appliedEl || applyBtnText.includes("applied")) {
            result.success = false;
            result.error = "ALREADY_APPLIED";
          } else if (applyBtn && !applyBtnText.includes("easy apply")) {
            result.success = false;
            result.error = "EXTERNAL_APPLY";
          } else {
            result.success = false;
            result.error = "NO_EASY_APPLY_BUTTON";
          }
        }
      }

      // ═══════════════════════════════════════════════════
      // ACTION: fillStep — Scan & fill current modal step
      // ═══════════════════════════════════════════════════
      else if (ACTION === "fillStep") {
        const modal = getEasyApplyModal();

        if (!modal) {
          result.success = false;
          result.error = "NO_MODAL_FOUND";
          // Breadcrumb: what WAS on the page when we found no modal?
          try {
            result.data = {
              diagnostic:
                "dialogs=" +
                document.querySelectorAll('[role="dialog"]').length +
                " easyApplyModals=" +
                document.querySelectorAll(".jobs-easy-apply-modal").length +
                " overlays=" +
                document.querySelectorAll(".artdeco-modal-overlay").length +
                " applyHeader=" +
                (document.querySelector("#jobs-apply-header") ? 1 : 0),
            };
          } catch (e) {}
          return JSON.stringify(result);
        }

        // Determine current step info
        const progressBar = modal.querySelector(
          ".artdeco-completeness-meter-linear__progress-element, progress",
        );
        const progressValue =
          progressBar?.getAttribute("value") ||
          progressBar?.style?.width ||
          "0";

        const stepIndicator = modal.querySelector(
          ".artdeco-completeness-meter-linear, .jobs-easy-apply-content header",
        );
        const stepText = stepIndicator?.textContent?.trim() || "";

        // Scan all form groups in the modal
        const formGroups = modal.querySelectorAll(
          ".jobs-easy-apply-form-section__grouping, " +
            ".fb-dash-form-element, " +
            ".jobs-easy-apply-form-element, " +
            ".artdeco-text-input, " +
            ".jobs-easy-apply-form-section__grouping .ember-view",
        );

        const filledFields = [];
        const unknownFields = [];
        const skippedFields = [];
        let hasFileUpload = false;
        const fileUploadSelectors = [];

        // 🚫 CRITICAL: Check if user has work experience
        const hasWorkExperience =
          Array.isArray(USER_PROFILE?.workExperiences) &&
          USER_PROFILE.workExperiences.length > 0;

        // 🚫 CRITICAL: Find work experience section boundaries if no work experience
        let workExperienceSectionElements = [];
        if (!hasWorkExperience) {
          // Find the h3 with "Work experience" text
          const allHeaders = modal.querySelectorAll(
            'h3, h2, h1, [class*="title"]',
          );
          for (const header of allHeaders) {
            const headerText = header.textContent.toLowerCase();
            console.log(`[Work Exp Check] Header found: "${headerText}"`);

            if (
              headerText.includes("work experience") ||
              headerText.includes("employment history") ||
              headerText.includes("professional experience") ||
              headerText.includes("work history")
            ) {
              console.log(`✅ Found Work Experience section header`);

              // Collect all form elements between this header and the next section header
              let nextEl = header.parentElement;
              let depth = 0;

              while (nextEl && depth < 20) {
                // If next element is a form group (fb-dash-form-element), collect it
                if (nextEl.classList.contains("fb-dash-form-element")) {
                  workExperienceSectionElements.push(nextEl);
                  console.log(`[Work Exp Elements] Added: ${nextEl.className}`);
                }

                // Check all descendants of current element
                const descendants = nextEl.querySelectorAll(
                  ".fb-dash-form-element",
                );
                descendants.forEach((desc) => {
                  if (!workExperienceSectionElements.includes(desc)) {
                    workExperienceSectionElements.push(desc);
                    console.log(`[Work Exp Elements] Added descendant`);
                  }
                });

                nextEl = nextEl.nextElementSibling;
                depth++;

                // Stop if we hit another major section header (h3 without work experience)
                if (
                  nextEl &&
                  (nextEl.tagName === "H3" ||
                    nextEl.tagName === "H2" ||
                    nextEl.tagName === "H1")
                ) {
                  const nextHeaderText = nextEl.textContent.toLowerCase();
                  if (
                    !nextHeaderText.includes("work") &&
                    nextHeaderText.trim().length > 0
                  ) {
                    console.log(
                      `[Work Exp] Reached next section: "${nextHeaderText}", stopping`,
                    );
                    break;
                  }
                }
              }

              break; // Found work experience section
            }
          }

          console.log(
            `[Work Exp] Total elements in section: ${workExperienceSectionElements.length}`,
          );
        }

        formGroups.forEach((group) => {
          let label = getGroupLabel(group);
          if (!label) return;

          // 🚫 CRITICAL: Skip if this element is in the work experience section and user has no work experience
          if (
            !hasWorkExperience &&
            workExperienceSectionElements.includes(group)
          ) {
            console.log(
              `⏭️  Skipping field "${label}" - part of work experience section (no work experience data)`,
            );
            skippedFields.push({
              label,
              reason: "No work experience in profile - skipped entire section",
            });
            return;
          }

          const errorMsg = group.querySelector(
            '.artdeco-inline-feedback--error, .fb-dash-form-element__error, [id*="-error"]',
          );
          if (errorMsg && errorMsg.textContent) {
            label =
              label +
              " (Constraint/Error: " +
              errorMsg.textContent.trim() +
              ")";
          }

          const numInput = group.querySelector('input[type="number"]');
          if (numInput) {
            const min = numInput.getAttribute("min");
            const step = numInput.getAttribute("step");
            if (step && step.includes(".")) {
              label += " (Constraint/Error: Enter a decimal number)";
            } else if (min !== null) {
              label += " (Constraint/Error: Enter a whole number)";
            }
          }

          const required = isRequired(group);

          // Check for file upload
          const fileInput = group.querySelector('input[type="file"]');
          if (fileInput) {
            hasFileUpload = true;
            fileUploadSelectors.push({
              label,
              selector: fileInput.id
                ? `#${fileInput.id}`
                : 'input[type="file"]',
              accept: fileInput.getAttribute("accept") || "",
            });
            return;
          }

          // Text inputs
          const textInput = group.querySelector(
            'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], input:not([type]):not([role])',
          );
          if (
            textInput &&
            textInput.type !== "hidden" &&
            textInput.type !== "file"
          ) {
            const currentVal = textInput.value.trim();
            const profileVal = matchToProfile(label);

            if (profileVal && (!currentVal || OPTIONS.overwrite)) {
              safeSetValue(textInput, String(profileVal));
              filledFields.push({
                label,
                value: String(profileVal),
                source: "profile",
              });
            } else if (!currentVal) {
              const aiAnswer = AI_ANSWERS.find(
                (a) =>
                  a.label === label ||
                  label.toLowerCase().includes(a.label.toLowerCase()) ||
                  a.label.toLowerCase().includes(label.toLowerCase()),
              );
              if (aiAnswer && aiAnswer.answer) {
                safeSetValue(textInput, aiAnswer.answer);
                filledFields.push({
                  label,
                  value: aiAnswer.answer,
                  source: "ai",
                });
              } else {
                unknownFields.push({
                  label,
                  type: "text",
                  required,
                  selector: textInput.id ? `#${textInput.id}` : "",
                });
              }
            } else {
              skippedFields.push({
                label,
                reason: "already filled",
                value: currentVal,
              });
            }
            return;
          }

          // Textarea
          const textarea = group.querySelector("textarea");
          if (textarea) {
            const currentVal = textarea.value.trim();
            const profileVal = matchToProfile(label);

            if (profileVal && (!currentVal || OPTIONS.overwrite)) {
              safeSetValue(textarea, String(profileVal));
              filledFields.push({
                label,
                value: String(profileVal),
                source: "profile",
              });
            } else if (!currentVal) {
              const aiAnswer = AI_ANSWERS.find(
                (a) =>
                  a.label === label ||
                  label.toLowerCase().includes(a.label.toLowerCase()) ||
                  a.label.toLowerCase().includes(label.toLowerCase()),
              );
              if (aiAnswer && aiAnswer.answer) {
                safeSetValue(textarea, aiAnswer.answer);
                filledFields.push({
                  label,
                  value: aiAnswer.answer,
                  source: "ai",
                });
              } else {
                unknownFields.push({
                  label,
                  type: "textarea",
                  required,
                  selector: textarea.id ? `#${textarea.id}` : "",
                });
              }
            } else {
              skippedFields.push({
                label,
                reason: "already filled",
                value: currentVal,
              });
            }
            return;
          }

          // Select dropdown
          const selectEl = group.querySelector("select");
          if (selectEl) {
            const currentVal = selectEl.value;
            const options = Array.from(selectEl.options)
              .map((o) => ({ text: o.text.trim(), value: o.value }))
              .filter((o) => o.value);
            const cappedOptions =
              options.length > 20
                ? [
                    ...options.map((o) => o.text).slice(0, 5),
                    "...(" + options.length + " total options)",
                  ]
                : options.map((o) => o.text);

            // Detect boolean/yes-no selects — ALWAYS use AI for these (profile text like "3 years" can't fill Yes/No)
            const optTexts = options.map((o) =>
              o.text.toLowerCase().replace(/[^a-z]/g, ""),
            );
            const isBooleanSelect =
              options.length <= 4 &&
              optTexts.some(
                (t) =>
                  t === "yes" ||
                  t === "no" ||
                  t === "yesno" ||
                  t === "true" ||
                  t === "false",
              );

            // Normalize helper for label matching
            const normalizeLabel = (s) =>
              s
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, "")
                .replace(/\s+/g, " ")
                .trim();

            // Helper: try filling from AI_ANSWERS
            function tryAiFill() {
              const normalLabel = normalizeLabel(label);
              const aiAnswer = AI_ANSWERS.find((a) => {
                const normalAI = normalizeLabel(a.label);
                return (
                  normalLabel === normalAI ||
                  normalLabel.includes(normalAI) ||
                  normalAI.includes(normalLabel) ||
                  normalLabel.replace(normalAI, "").trim() === "" ||
                  (normalLabel.length > 0 &&
                    normalAI.startsWith(
                      normalLabel.substring(
                        0,
                        Math.min(30, normalLabel.length),
                      ),
                    ))
                );
              });
              console.log(
                `[AI Fill] Label: "${label}" | isBooleanSelect: ${isBooleanSelect} | AI_ANSWERS count: ${AI_ANSWERS.length}`,
              );
              if (aiAnswer && aiAnswer.answer) {
                const target = aiAnswer.answer.toLowerCase().trim();
                const match = options.find(
                  (o) =>
                    o.text.toLowerCase() === target ||
                    o.value.toLowerCase() === target ||
                    o.text.toLowerCase().includes(target) ||
                    target.includes(o.text.toLowerCase()),
                );
                console.log(
                  `[AI Fill] Answer: "${aiAnswer.answer}" | Matched: ${match ? match.text : "NONE"} | Options: ${options.map((o) => o.text).join(", ")}`,
                );
                if (match) {
                  safeSetSelectValue(selectEl, match.value);
                  console.log(
                    `✅ [AI Fill] Set select "${label}" = "${match.value}"`,
                  );
                  filledFields.push({ label, value: match.text, source: "ai" });
                  return true;
                } else {
                  console.warn(
                    `⚠️ [AI Fill] No option matched "${aiAnswer.answer}" in "${label}"`,
                  );
                }
              } else {
                console.warn(
                  `⚠️ [AI Fill] No AI answer for "${label}" (checked ${AI_ANSWERS.length} answers)`,
                );
              }
              unknownFields.push({
                label,
                type: "select",
                required,
                options: cappedOptions,
                selector: selectEl.id ? `#${selectEl.id}` : "",
              });
              return false;
            }

            const isBlank =
              !currentVal ||
              currentVal === "" ||
              currentVal === "Select an option" ||
              currentVal === "Select";

            if (
              !isBooleanSelect &&
              matchToProfile(label) &&
              (isBlank || OPTIONS.overwrite)
            ) {
              // Profile-based fill: only for non-boolean selects where profile has a value
              const profileVal = matchToProfile(label);
              const target = String(profileVal).toLowerCase();
              const match =
                options.find(
                  (o) =>
                    o.text.toLowerCase().includes(target) ||
                    target.includes(o.text.toLowerCase()),
                ) ||
                options.find((o) => o.value.toLowerCase().includes(target));
              if (match) {
                safeSetSelectValue(selectEl, match.value);
                filledFields.push({
                  label,
                  value: match.text,
                  source: "profile",
                });
              } else {
                // Profile value didn't match any option — fall back to AI
                console.log(
                  `[Select] Profile val "${profileVal}" didn't match any option in "${label}", trying AI...`,
                );
                if (isBlank) tryAiFill();
                else
                  skippedFields.push({
                    label,
                    reason: "profile mismatch, already has value",
                  });
              }
            } else if (isBlank) {
              // Either it's a boolean select, or no profile value — always try AI
              tryAiFill();
            } else {
              skippedFields.push({
                label,
                reason: "already selected",
                value: currentVal,
              });
            }
            return;
          }

          // Radio buttons
          const radios = group.querySelectorAll('input[type="radio"]');
          if (radios.length > 0) {
            const isChecked = Array.from(radios).some((r) => r.checked);

            // ── Find label by raw .getAttribute('for') comparison — NOT CSS.escape ──
            // CSS.escape is for #id selectors only. Attribute value selectors [for="..."] need raw string.
            // LinkedIn radio IDs contain ':' and '()' which CSS.escape wrongly escapes in attr selectors.
            function findLabelForRadio(radioEl) {
              if (radioEl.id) {
                const allLabels = Array.from(
                  document.querySelectorAll("label"),
                );
                const found = allLabels.find(
                  (l) => l.getAttribute("for") === radioEl.id,
                );
                if (found) return found;
              }
              return radioEl.closest("label") || null;
            }

            const radioOptions = Array.from(radios).map((r) => {
              let lblText = "";
              const assocLabel = findLabelForRadio(r);
              if (assocLabel)
                lblText = assocLabel.textContent.trim().replace(/\s+/g, " ");
              if (!lblText)
                lblText =
                  r.parentElement?.textContent?.trim().replace(/\s+/g, " ") ||
                  r.value;
              return { text: lblText, value: r.value, element: r };
            });

            // ── Ember-compatible radio click ─────────────────────────────────────────
            function clickRadio(radioEl) {
              console.log(
                `[clickRadio] value="${radioEl.value}" id="${radioEl.id}"`,
              );
              radioEl.scrollIntoView({ behavior: "instant", block: "center" });

              // Step 1: Click the outer Ember container div [data-test-text-selectable-option]
              const containerDiv = radioEl.closest(
                "[data-test-text-selectable-option]",
              );
              if (containerDiv) {
                const rc = containerDiv.getBoundingClientRect();
                const cxc = rc.left + rc.width / 2,
                  cyc = rc.top + rc.height / 2;
                const oc = {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: cxc,
                  clientY: cyc,
                  button: 0,
                };
                containerDiv.dispatchEvent(new MouseEvent("pointerdown", oc));
                containerDiv.dispatchEvent(new MouseEvent("mousedown", oc));
                containerDiv.dispatchEvent(new MouseEvent("pointerup", oc));
                containerDiv.dispatchEvent(new MouseEvent("mouseup", oc));
                containerDiv.dispatchEvent(new MouseEvent("click", oc));
                containerDiv.click();
                console.log("[clickRadio] clicked container div");
              }

              // Step 2: Click the <label> element (browser natively checks the radio on label click)
              const labelEl = findLabelForRadio(radioEl);
              if (labelEl) {
                const rl = labelEl.getBoundingClientRect();
                const cxl = rl.left + rl.width / 2,
                  cyl = rl.top + rl.height / 2;
                const ol = {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: cxl,
                  clientY: cyl,
                  button: 0,
                };
                labelEl.dispatchEvent(new MouseEvent("pointerdown", ol));
                labelEl.dispatchEvent(new MouseEvent("mousedown", ol));
                labelEl.dispatchEvent(new MouseEvent("pointerup", ol));
                labelEl.dispatchEvent(new MouseEvent("mouseup", ol));
                labelEl.dispatchEvent(new MouseEvent("click", ol));
                labelEl.click();
                console.log(
                  `[clickRadio] clicked label: "${labelEl.textContent.trim()}"`,
                );
              } else {
                realClick(radioEl);
                console.log(
                  "[clickRadio] fallback: clicked radio input directly",
                );
              }

              // Step 3: Use native HTMLInputElement checked setter (bypasses framework overrides)
              try {
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "checked",
                )?.set;
                if (nativeSetter) nativeSetter.call(radioEl, true);
                else radioEl.checked = true;
              } catch (e) {
                radioEl.checked = true;
              }

              // Step 4: Fire input + change events so Ember/React data binding picks up the change
              radioEl.dispatchEvent(new Event("input", { bubbles: true }));
              radioEl.dispatchEvent(new Event("change", { bubbles: true }));

              // Step 5: Simulate keyboard Space (browsers check radio on Space keypress)
              radioEl.focus();
              radioEl.dispatchEvent(
                new KeyboardEvent("keydown", {
                  bubbles: true,
                  cancelable: true,
                  key: " ",
                  code: "Space",
                  keyCode: 32,
                }),
              );
              radioEl.dispatchEvent(
                new KeyboardEvent("keyup", {
                  bubbles: true,
                  key: " ",
                  code: "Space",
                  keyCode: 32,
                }),
              );

              // Step 6: React fiber onChange hook
              try {
                const fiberKey = Object.keys(radioEl).find(
                  (k) =>
                    k.startsWith("__reactFiber") ||
                    k.startsWith("__reactInternalInstance") ||
                    k.startsWith("__reactEventHandlers") ||
                    k.startsWith("_reactFiber"),
                );
                if (fiberKey) {
                  const fiber = radioEl[fiberKey];
                  const props = fiber?.memoizedProps || fiber?.pendingProps;
                  if (props?.onChange)
                    props.onChange({
                      target: radioEl,
                      currentTarget: radioEl,
                      bubbles: true,
                    });
                }
              } catch (e) {
                /* ignore */
              }

              console.log(`[clickRadio] done. checked=${radioEl.checked}`);
            }

            // Normalize label — strip error suffix before AI lookup
            const normalizeLabel = (s) =>
              s
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, "")
                .replace(/\s+/g, " ")
                .trim();
            const baseLabel = label
              .replace(/\s*\(Constraint\/Error:[^)]*\)/gi, "")
              .trim();
            const normalBase = normalizeLabel(baseLabel);

            if (!isChecked || OPTIONS.overwrite) {
              const profileVal = matchToProfile(baseLabel);
              if (profileVal) {
                const target = String(profileVal).toLowerCase();
                const match = radioOptions.find(
                  (o) =>
                    o.text.toLowerCase().includes(target) ||
                    target.includes(o.text.toLowerCase()),
                );
                if (match) {
                  clickRadio(match.element);
                  filledFields.push({
                    label,
                    value: match.text,
                    source: "profile",
                  });
                } else {
                  unknownFields.push({
                    label,
                    type: "radio",
                    required,
                    options: radioOptions.map((o) => o.text),
                  });
                }
              } else {
                // Strip error suffix from AI answer labels too before matching
                const aiAnswer = AI_ANSWERS.find((a) => {
                  const normalAI = normalizeLabel(
                    a.label
                      .replace(/\s*\(Constraint\/Error:[^)]*\)/gi, "")
                      .trim(),
                  );
                  return (
                    normalBase === normalAI ||
                    normalBase.includes(normalAI) ||
                    normalAI.includes(normalBase)
                  );
                });
                console.log(
                  `[Radio] baseLabel="${baseLabel}" | normalBase="${normalBase}" | AI_ANSWERS=[${AI_ANSWERS.map((a) => a.label).join(" | ")}]`,
                );
                if (aiAnswer && aiAnswer.answer) {
                  const target = aiAnswer.answer.toLowerCase().trim();
                  console.log(
                    `[Radio] AI answer="${aiAnswer.answer}" target="${target}" | options=[${radioOptions.map((o) => o.text).join(", ")}]`,
                  );
                  const match = radioOptions.find(
                    (o) =>
                      o.text.toLowerCase().trim() === target ||
                      o.text.toLowerCase().includes(target) ||
                      target.includes(o.text.toLowerCase().trim()),
                  );
                  if (match) {
                    clickRadio(match.element);
                    filledFields.push({
                      label,
                      value: match.text,
                      source: "ai",
                    });
                  } else if (radioOptions[0]) {
                    console.warn(
                      `[Radio] No match for "${target}", falling back to first option`,
                    );
                    clickRadio(radioOptions[0].element);
                    filledFields.push({
                      label,
                      value: radioOptions[0].text,
                      source: "ai-fallback",
                    });
                  }
                } else {
                  unknownFields.push({
                    label,
                    type: "radio",
                    required,
                    options: radioOptions.map((o) => o.text),
                  });
                }
              }
            } else {
              skippedFields.push({ label, reason: "already selected" });
            }
            return;
          }

          // Checkbox / multi-select checkboxes
          const checkboxes = group.querySelectorAll('input[type="checkbox"]');
          if (checkboxes.length > 0) {
            // Get the full context text — legend (for fieldsets) covers disclaimer text
            const legendEl = group.querySelector("legend");
            const legendText = (legendEl?.textContent || "").toLowerCase();
            const groupText = group.textContent.toLowerCase();

            // Patterns indicating consent/terms/disclaimer — always auto-check these
            const consentPatterns = [
              "agree",
              "consent",
              "confirm",
              "accept",
              "terms",
              "disclaimer",
              "acknowledge",
              "privacy",
              "policy",
              "authoriz",
              "certif",
              "declaration",
              "application",
              "i have read",
              "i understand",
              "sharing",
              "data",
            ];

            checkboxes.forEach((cb) => {
              if (!cb.checked) {
                const cbIdDesc = cb.id ? CSS.escape(cb.id) : "";
                const cbLabelEl = cbIdDesc
                  ? document.querySelector(`label[for="${cbIdDesc}"]`)
                  : cb.closest("label");
                const cbLabelText = (cbLabelEl?.textContent || "")
                  .toLowerCase()
                  .trim();

                // Check cbLabel, legend, and group text for consent patterns
                const textToCheck =
                  cbLabelText + " " + legendText + " " + groupText;
                const isConsent = consentPatterns.some((p) =>
                  textToCheck.includes(p),
                );

                if (isConsent || required) {
                  console.log(
                    `[Checkbox] Auto-checking: "${cbLabelText || label}" (consent/terms detected)`,
                  );
                  if (cbLabelEl) realClick(cbLabelEl);
                  else {
                    realClick(cb);
                    cb.checked = true;
                    cb.dispatchEvent(new Event("change", { bubbles: true }));
                  }
                  filledFields.push({
                    label: cbLabelText || label,
                    value: "checked",
                    source: "auto",
                  });
                } else {
                  unknownFields.push({
                    label: cbLabelText || label,
                    type: "checkbox",
                    required,
                    options: ["Yes", "No"],
                  });
                }
              } else {
                skippedFields.push({
                  label,
                  reason: "checkbox already checked",
                });
              }
            });
            return;
          }

          // LinkedIn typeahead / combobox
          const typeahead = group.querySelector(
            '[role="combobox"], .artdeco-typeahead-input, .basic-typeahead',
          );
          if (typeahead) {
            const input = typeahead.querySelector("input") || typeahead;
            const currentVal = input.value?.trim();
            const profileVal = matchToProfile(label);

            if (profileVal && (!currentVal || OPTIONS.overwrite)) {
              safeSetValue(input, String(profileVal));
              filledFields.push({
                label,
                value: String(profileVal),
                source: "profile",
                needsTypeaheadSelect: true,
              });
            } else if (!currentVal) {
              unknownFields.push({
                label,
                type: "typeahead",
                required,
                selector: "",
              });
            }
            return;
          }
        });

        // Determine what buttons are available in the modal footer
        const footer = modal.querySelector(
          ".jobs-easy-apply-modal__footer, .artdeco-modal__actionbar, footer",
        );
        const buttons = {};

        if (footer) {
          const footerBtns = footer.querySelectorAll("button");
          footerBtns.forEach((btn) => {
            const text = btn.textContent.trim().toLowerCase();
            const ariaLabel = (
              btn.getAttribute("aria-label") || ""
            ).toLowerCase();

            if (
              text.includes("next") ||
              ariaLabel.includes("next step") ||
              ariaLabel.includes("continue")
            )
              buttons.next = true;
            if (text.includes("review") || ariaLabel.includes("review"))
              buttons.review = true;
            if (
              text.includes("submit") ||
              ariaLabel.includes("submit application")
            )
              buttons.submit = true;
            if (
              text.includes("back") ||
              ariaLabel.includes("back") ||
              ariaLabel.includes("previous")
            )
              buttons.back = true;
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
          totalFormGroups: formGroups.length,
        };
      }

      // ═══════════════════════════════════════════════════
      // ACTION: nextStep — Click Next / Review / Submit
      // ═══════════════════════════════════════════════════
      else if (ACTION === "nextStep") {
        // Check for "Continue applying" safety modal first
        const safetyBtn = Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent.trim().toLowerCase() === "continue applying",
        );
        if (safetyBtn) {
          realClick(safetyBtn);
          result.success = true;
          result.data = { clicked: "continue_applying_safety_modal" };
          return JSON.stringify(result);
        }

        const modal = getEasyApplyModal();
        if (!modal) {
          result.success = false;
          result.error = "NO_MODAL_FOUND";
          return JSON.stringify(result);
        }

        const footer = modal.querySelector(
          ".jobs-easy-apply-modal__footer, .artdeco-modal__actionbar, footer",
        );
        if (!footer) {
          result.success = false;
          result.error = "NO_FOOTER_FOUND";
          return JSON.stringify(result);
        }

        const footerBtns = footer.querySelectorAll("button");
        let clicked = null;

        // Priority: Submit > Review > Next
        for (const btn of footerBtns) {
          const text = btn.textContent.trim().toLowerCase();
          const ariaLabel = (
            btn.getAttribute("aria-label") || ""
          ).toLowerCase();
          if (
            text.includes("submit") ||
            ariaLabel.includes("submit application")
          ) {
            realClick(btn);
            clicked = "submit";
            break;
          }
        }

        if (!clicked) {
          for (const btn of footerBtns) {
            const text = btn.textContent.trim().toLowerCase();
            const ariaLabel = (
              btn.getAttribute("aria-label") || ""
            ).toLowerCase();
            if (text.includes("review") || ariaLabel.includes("review")) {
              realClick(btn);
              clicked = "review";
              break;
            }
          }
        }

        if (!clicked) {
          for (const btn of footerBtns) {
            const text = btn.textContent.trim().toLowerCase();
            const ariaLabel = (
              btn.getAttribute("aria-label") || ""
            ).toLowerCase();
            if (
              text.includes("next") ||
              ariaLabel.includes("next") ||
              ariaLabel.includes("continue")
            ) {
              realClick(btn);
              clicked = "next";
              break;
            }
          }
        }

        if (clicked) {
          result.success = true;
          result.data = { clicked };
        } else {
          result.success = false;
          result.error = "NO_NAVIGATION_BUTTON";
        }
      }

      // ═══════════════════════════════════════════════════
      // ACTION: submitApp — Specifically click Submit
      // ═══════════════════════════════════════════════════
      else if (ACTION === "submitApp") {
        const modal = getEasyApplyModal();
        if (!modal) {
          result.success = false;
          result.error = "NO_MODAL_FOUND";
          return JSON.stringify(result);
        }

        const submitSelectors = [
          'button[aria-label="Submit application"]',
          'button[aria-label="Submit"]',
          "footer button.artdeco-button--primary",
        ];

        let submitBtn = null;
        for (const sel of submitSelectors) {
          submitBtn = modal.querySelector(sel);
          if (submitBtn) break;
        }

        if (!submitBtn) {
          const allBtns = modal.querySelectorAll("button");
          for (const btn of allBtns) {
            if (btn.textContent.trim().toLowerCase().includes("submit")) {
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
          result.error = "NO_SUBMIT_BUTTON";
        }
      }

      // ═══════════════════════════════════════════════════
      // ACTION: dismissModal — Close the Easy Apply modal
      // ═══════════════════════════════════════════════════
      else if (ACTION === "dismissModal") {
        const dismissSelectors = [
          'button[aria-label="Dismiss"]',
          ".artdeco-modal__dismiss",
          ".jobs-easy-apply-modal__close-button",
          "button[data-test-modal-close-btn]",
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
            const discardBtn = document.querySelector(
              'button[data-test-dialog-primary-btn], button[data-control-name="discard_application_confirm_btn"]',
            );
            if (discardBtn) {
              realClick(discardBtn);
            } else {
              const allBtns = document.querySelectorAll("button");
              for (const b of allBtns) {
                if (
                  b.textContent.trim().toLowerCase() === "discard" ||
                  b.textContent.trim().toLowerCase().includes("discard")
                ) {
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
          result.error = "NO_DISMISS_BUTTON";
        }
      }

      // ═══════════════════════════════════════════════════
      // ACTION: checkStatus — Check if application was submitted
      // ═══════════════════════════════════════════════════
      else if (ACTION === "checkStatus") {
        const modal = getEasyApplyModal();
        const successMsg = document.querySelector(
          ".artdeco-inline-feedback--success, .artdeco-toast-item--visible",
        );
        const successText =
          document.body.textContent.includes("Your application was sent") ||
          document.body.textContent.includes("Application submitted") ||
          document.body.textContent.includes("application was submitted");

        const applyBtn = document.querySelector(".jobs-apply-button");
        const showsApplied = applyBtn?.textContent?.includes("Applied");

        if (successMsg || successText || showsApplied) {
          result.success = true;
          result.data = {
            applicationSent: true,
            hasSuccessMessage: !!successMsg || successText,
            showsApplied: !!showsApplied,
            modalDismissed: !modal,
          };
        } else if (!modal) {
          result.success = false;
          result.data = {
            applicationSent: false,
            modalStillOpen: false,
            validationErrors: [],
          };
        } else {
          const errorMsgs = modal.querySelectorAll(
            ".artdeco-inline-feedback--error, .fb-dash-form-element__error",
          );
          const errors = Array.from(errorMsgs)
            .map((e) => e.textContent.trim())
            .filter(Boolean);

          result.success = false;
          result.data = {
            applicationSent: false,
            modalStillOpen: true,
            validationErrors: errors,
          };
        }
      }

      // ═══════════════════════════════════════════════════
      // ACTION: scrollJobList — Scroll for more jobs / pagination
      // ═══════════════════════════════════════════════════
      else if (ACTION === "scrollJobList") {
        const seeMoreBtn = document.querySelector(
          '.jobs-search-results-list__pagination button, .infinite-scroller__show-more-button, button[aria-label="See more jobs"]',
        );

        if (seeMoreBtn) {
          realClick(seeMoreBtn);
          result.success = true;
          result.data = { action: "clickedSeeMore" };
        } else {
          const currentPage = document.querySelector(
            ".artdeco-pagination__indicator--number.active, .artdeco-pagination__indicator--number.selected",
          );
          if (currentPage) {
            const nextPage = currentPage.nextElementSibling;
            if (nextPage) {
              const link = nextPage.querySelector("button, a");
              if (link) {
                realClick(link);
                result.success = true;
                result.data = { action: "nextPage" };
              } else {
                result.success = false;
                result.error = "NO_MORE_PAGES";
              }
            } else {
              result.success = false;
              result.error = "NO_MORE_PAGES";
            }
          } else {
            const listContainer = document.querySelector(
              '[data-testid="lazy-column"], [data-component-type="LazyColumn"], [componentkey="SearchResultsMainContent"], .jobs-search-results-list, .scaffold-layout__list',
            );
            if (listContainer) {
              listContainer.scrollTop = listContainer.scrollHeight;
              result.success = true;
              result.data = { action: "scrolled" };
            } else {
              window.scrollBy(0, 500);
              result.success = true;
              result.data = { action: "windowScrolled" };
            }
          }
        }
      }

      // ═══════════════════════════════════════════════════
      // ACTION: getJobDescription — Extract CLEAN PLAIN TEXT job details
      // Extracts text only, strips all HTML tags
      // ═══════════════════════════════════════════════════
      else if (ACTION === "getJobDescription") {
        // Job title from the detail pane
        const titleEl = document.querySelector(
          ".job-details-jobs-unified-top-card__job-title h1 a, " +
            ".job-details-jobs-unified-top-card__job-title h1, " +
            ".jobs-unified-top-card__job-title, " +
            "h1.t-24.t-bold, " +
            "h1.t-24",
        );

        // Company name from detail pane
        const companyEl = document.querySelector(
          ".job-details-jobs-unified-top-card__company-name a, " +
            ".job-details-jobs-unified-top-card__company-name, " +
            ".jobs-unified-top-card__company-name a, " +
            ".jobs-unified-top-card__subtitle-primary-grouping a",
        );

        // Location from detail pane
        const locationEl = document.querySelector(
          ".job-details-jobs-unified-top-card__tertiary-description-container .tvm__text--low-emphasis, " +
            ".jobs-unified-top-card__bullet, " +
            ".jobs-unified-top-card__subtitle-secondary-grouping span",
        );

        // Work type badges (Remote, Full-time, etc.)
        const workTypeBadges = document.querySelectorAll(
          ".job-details-fit-level-preferences button span",
        );
        const workTypes = Array.from(workTypeBadges)
          .map((s) => s.textContent.trim())
          .filter(Boolean);

        // Job description — extract as PLAIN TEXT
        const descContainer = document.querySelector(
          "#job-details, " +
            ".jobs-description__content, " +
            ".jobs-description-content__text, " +
            ".jobs-box__html-content, " +
            ".jobs-description",
        );

        const description = plainText(descContainer);

        // Company info — extract as PLAIN TEXT
        const companyInfoEl = document.querySelector(
          ".jobs-company__company-description",
        );
        const companyInfo = plainText(companyInfoEl);

        // Company details (industry, size)
        const companyDetailsEl = document.querySelector(
          ".jobs-company__box .t-14.mt5",
        );
        const companyDetails =
          companyDetailsEl?.textContent?.trim()?.replace(/\s+/g, " ") || "";

        result.success = true;
        result.data = {
          title: titleEl?.textContent?.trim() || "",
          company: companyEl?.textContent?.trim() || "",
          location: locationEl?.textContent?.trim() || "",
          workTypes,
          companyDetails,
          companyInfo: companyInfo.substring(0, 500),
          description: description.substring(0, 5000),
        };
      }

      // ═══════════════════════════════════════════════════
      // ACTION: scrollJobList — paginate or scroll job results
      // ═══════════════════════════════════════════════════
      else if (ACTION === "scrollJobList") {
        // Try clicking the "Next page" pagination button
        const nextPageSelectors = [
          'button[aria-label="View next page"]',
          "button.artdeco-pagination__button--next",
          "[data-test-pagination-next-btn]",
          ".artdeco-pagination__button--next",
          'li.artdeco-pagination__indicator--number[data-test-pagination-page-btn]:not([aria-selected="true"]) + li button',
        ];
        let nextBtn = null;
        for (const sel of nextPageSelectors) {
          try {
            const btn = document.querySelector(sel);
            if (
              btn &&
              !btn.disabled &&
              btn.getAttribute("aria-disabled") !== "true"
            ) {
              nextBtn = btn;
              break;
            }
          } catch (e) { /* ignore selector errors */ }
        }

        if (nextBtn) {
          nextBtn.scrollIntoView({ behavior: "instant", block: "center" });
          nextBtn.click();
          result.success = true;
          result.data = { action: "nextPage" };
        } else {
          // Fallback: scroll the job list panel to trigger lazy loading
          const listPanel = document.querySelector(
            ".jobs-search-results-list, " +
            ".jobs-search__results-list, " +
            ".scaffold-layout__list, " +
            "[class*='jobs-search-results']"
          );
          if (listPanel) {
            const prevScrollTop = listPanel.scrollTop;
            listPanel.scrollTop = listPanel.scrollHeight;
            // Only succeed if scroll actually moved
            if (listPanel.scrollTop !== prevScrollTop) {
              result.success = true;
              result.data = { action: "scrolled" };
            } else {
              result.success = false;
              result.error = "Already at bottom of list";
            }
          } else {
            result.success = false;
            result.error = "No next page button or scrollable list found";
          }
        }
      }

  return JSON.stringify(result);
})(FIELD_MAP_PLACEHOLDER, USER_PROFILE_PLACEHOLDER, OPTIONS_PLACEHOLDER);
