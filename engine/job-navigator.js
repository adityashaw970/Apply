/**
 * Job Navigator - Navigates job listing pages, finds postings, clicks apply buttons
 */
class JobNavigator {
  constructor() {
    // Common "Apply" button selectors across major job sites
    this.applyButtonSelectors = [
      // Generic
      'button:has-text("Apply")',
      'a:has-text("Apply")',
      'button:has-text("Apply Now")',
      'a:has-text("Apply Now")',
      'button:has-text("Quick Apply")',
      'a:has-text("Quick Apply")',
      'button:has-text("Easy Apply")',
      'a:has-text("Easy Apply")',
      '[class*="apply" i]',
      '[id*="apply" i]',
      '[data-action*="apply" i]',

      // Internshala specific
      '.btn.btn-primary.campaign-btn',
      '#continue_button',
      '.apply_button',
      'a.btn-primary[href*="apply"]',

      // LinkedIn
      '.jobs-apply-button',
      '.jobs-s-apply button',

      // Naukri
      '.apply-button-container button',
      '#apply-button',

      // Indeed
      '#indeedApplyButton',
      '.jobsearch-IndeedApplyButton-newDesign',

      // Generic fallbacks
      'input[type="submit"][value*="apply" i]',
      'input[type="submit"][value*="submit" i]',
      'button[type="submit"]'
    ];

    // Job card selectors for listing pages
    this.jobCardSelectors = [
      // Generic
      '[class*="job-card"]',
      '[class*="job-listing"]',
      '[class*="job-item"]',
      '[class*="job_card"]',
      '[class*="jobCard"]',
      '[class*="search-result"]',
      'article[class*="job"]',

      // Internshala
      '.individual_internship',
      '.internship_meta',
      '.individual_internship_header a',

      // LinkedIn
      '.job-card-container',
      '.jobs-search-results__list-item',

      // Naukri
      '.jobTuple',
      '.srp-jobtuple-wrapper',

      // Indeed
      '.job_seen_beacon',
      '.jobsearch-ResultsList > li',

      // Generic fallbacks
      '[data-job-id]',
      '[data-entity-urn*="job"]',
      'li[class*="result"]'
    ];
  }

  /**
   * Find all job postings on the current listing page
   * @param {import('puppeteer').Page} page
   * @returns {Array} Array of { selector, title, company, link }
   */
  async findJobPostings(page) {
    const jobs = [];

    // Try each job card selector
    for (const selector of this.jobCardSelectors) {
      try {
        const cards = await page.$$(selector);
        if (cards.length > 0) {
          for (let i = 0; i < cards.length; i++) {
            const jobInfo = await cards[i].evaluate((el, idx) => {
              // Extract job title
              const titleEl = el.querySelector('h2, h3, h4, [class*="title"], [class*="heading"], a');
              const title = titleEl?.textContent?.trim() || `Job ${idx + 1}`;

              // Extract company
              const companyEl = el.querySelector('[class*="company"], [class*="employer"], .subtitle');
              const company = companyEl?.textContent?.trim() || '';

              // Extract link
              const linkEl = el.querySelector('a[href]');
              const link = linkEl?.href || '';

              return { title: title.substring(0, 100), company: company.substring(0, 100), link };
            }, i);

            jobs.push({
              ...jobInfo,
              cardIndex: i,
              cardSelector: selector
            });
          }
          break; // Found cards with this selector, stop trying others
        }
      } catch (e) {
        continue;
      }
    }

    return jobs;
  }

  /**
   * Click on a specific job card to open its details
   */
  async clickJobCard(page, job) {
    try {
      const cards = await page.$$(job.cardSelector);
      if (cards[job.cardIndex]) {
        await cards[job.cardIndex].click();
        await page.waitForTimeout(2000);
        return true;
      }
    } catch (e) {
      // Try navigating directly if we have a link
      if (job.link) {
        await page.goto(job.link, { waitUntil: 'networkidle2', timeout: 15000 });
        return true;
      }
    }
    return false;
  }

  /**
   * Find and click the "Apply" / "Apply Now" button
   * @returns {boolean} true if apply button was found and clicked
   */
  async clickApplyButton(page) {
    // Strategy 1: Try CSS selectors
    for (const selector of this.applyButtonSelectors) {
      try {
        // Skip :has-text pseudo-selector for querySelector
        if (selector.includes(':has-text')) continue;

        const button = await page.$(selector);
        if (button) {
          const isVisible = await button.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
          });

          if (isVisible) {
            await button.click();
            await page.waitForTimeout(2000);
            return true;
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Strategy 2: Text content search using evaluate
    const clicked = await page.evaluate(() => {
      const applyTexts = ['apply now', 'apply', 'quick apply', 'easy apply', 'submit application'];
      const elements = [...document.querySelectorAll('button, a, input[type="submit"]')];

      for (const text of applyTexts) {
        for (const el of elements) {
          const elText = (el.textContent || el.value || '').toLowerCase().trim();
          if (elText === text || elText.includes(text)) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null) {
              el.click();
              return true;
            }
          }
        }
      }
      return false;
    });

    if (clicked) {
      await page.waitForTimeout(2000);
      return true;
    }

    return false;
  }

  /**
   * Check if the current page has a form (inline application)
   */
  async hasInlineForm(page) {
    return await page.evaluate(() => {
      const forms = document.querySelectorAll('form');
      for (const form of forms) {
        const inputs = form.querySelectorAll('input:not([type="hidden"]), select, textarea');
        if (inputs.length >= 2) return true;
      }
      // Also check for forms without <form> tags
      const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
      return inputs.length >= 3;
    });
  }

  /**
   * Find and click the submit button for a form
   */
  async clickSubmitButton(page) {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:not([type])',
      '.submit-btn',
      '.btn-submit',
      '#submit',
      '#submitBtn',
      'button[class*="submit" i]',
      'button[id*="submit" i]'
    ];

    // Try text-based search
    const clicked = await page.evaluate((selectors) => {
      // Try selectors first
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }

      // Try text content
      const submitTexts = ['submit', 'submit application', 'apply', 'send', 'confirm'];
      const buttons = [...document.querySelectorAll('button, input[type="submit"]')];
      for (const text of submitTexts) {
        for (const btn of buttons) {
          const btnText = (btn.textContent || btn.value || '').toLowerCase().trim();
          if (btnText.includes(text) && btn.offsetParent !== null) {
            btn.click();
            return true;
          }
        }
      }
      return false;
    }, submitSelectors);

    if (clicked) {
      await page.waitForTimeout(3000);
    }
    return clicked;
  }

  /**
   * Extract job description text from the page
   */
  async extractJobDescription(page) {
    return await page.evaluate(() => {
      const descSelectors = [
        '[class*="description"]',
        '[class*="job-desc"]',
        '[class*="jobDescription"]',
        '[class*="detail"]',
        '#job-description',
        '#jobDescription',
        'article',
        '.content',
        'main'
      ];

      for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim().length > 50) {
          return el.textContent.trim().substring(0, 3000);
        }
      }

      return document.body.textContent.trim().substring(0, 2000);
    });
  }

  /**
   * Check for pagination and go to next page
   */
  async goToNextPage(page) {
    const nextSelectors = [
      'a[aria-label="Next"]',
      'button[aria-label="Next"]',
      '.next-page',
      '.pagination .next',
      'a.next',
      '[class*="next-btn"]',
      'a[rel="next"]',
      '.pagination li:last-child a',
      'button:has-text("Next")',
      'a:has-text("Next")'
    ];

    for (const selector of nextSelectors) {
      if (selector.includes(':has-text')) continue;
      try {
        const el = await page.$(selector);
        if (el) {
          const isEnabled = await el.evaluate(el => {
            return !el.disabled && !el.classList.contains('disabled') &&
                   el.getAttribute('aria-disabled') !== 'true';
          });
          if (isEnabled) {
            await el.click();
            await page.waitForTimeout(3000);
            return true;
          }
        }
      } catch (e) {
        continue;
      }
    }
    return false;
  }
}

module.exports = { JobNavigator };
