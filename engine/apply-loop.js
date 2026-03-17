const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { AIService } = require('./ai-service');
const { FormFiller } = require('./form-filler');
const { JobNavigator } = require('./job-navigator');
const { ProfileStore } = require('./profile-store');
const Store = require('electron-store');

puppeteer.use(StealthPlugin());

class ApplyLoop {
  constructor(options) {
    this.profile = options.profile;
    this.settings = options.settings;
    this.tabUrls = options.tabUrls || [];
    this.limit = options.limit || 50;
    this.onProgress = options.onProgress || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});

    this.isRunning = false;
    this.isPaused = false;
    this._shouldStop = false;

    this.appliedCount = 0;
    this.failedCount = 0;
    this.skippedCount = 0;
    this.logs = [];

    this.browser = null;
    this.page = null;
    this.aiService = null;
    this.formFiller = null;
    this.jobNavigator = new JobNavigator();
    this.store = new Store();

    // Initialize AI if key is present
    if (this.settings.geminiApiKey) {
      this.aiService = new AIService(this.settings.geminiApiKey);
      try {
        this.aiService.initialize();
      } catch (e) {
        this._log('warn', `AI Service init failed: ${e.message}. Will fill forms without AI.`);
      }
    }

    // Initialize form filler
    const profileStore = new ProfileStore(this.store);
    // Temporarily save profile to get the field map
    profileStore.saveProfile(this.profile);
    const fieldMap = profileStore.getFieldMap();
    this.formFiller = new FormFiller(fieldMap, this.aiService);
  }

  async start() {
    this.isRunning = true;
    this._shouldStop = false;
    this.isPaused = false;

    this._log('info', '🚀 Starting Mass Apply Engine...');
    this._log('info', `📋 Target: ${this.limit} applications across ${this.tabUrls.length} sites`);

    try {
      // Launch browser
      this._log('info', '🌐 Launching browser...');
      this.browser = await puppeteer.launch({
        headless: false, // Show browser for debugging
        defaultViewport: { width: 1366, height: 768 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--window-size=1366,768'
        ]
      });

      this.page = await this.browser.newPage();

      // Set realistic user agent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Process each tab URL
      for (const url of this.tabUrls) {
        if (this._shouldStop || this.appliedCount >= this.limit) break;

        this._log('info', `\n📌 Processing: ${url}`);
        await this._processTabUrl(url);
      }

    } catch (error) {
      this._log('error', `❌ Engine error: ${error.message}`);
      this.onError(error.message);
    } finally {
      // Cleanup
      if (this.browser) {
        try {
          await this.browser.close();
        } catch (e) { /* ignore */ }
      }

      this.isRunning = false;
      const summary = {
        applied: this.appliedCount,
        failed: this.failedCount,
        skipped: this.skippedCount,
        total: this.appliedCount + this.failedCount + this.skippedCount
      };

      this._log('info', `\n🏁 Engine finished! Applied: ${summary.applied}, Failed: ${summary.failed}, Skipped: ${summary.skipped}`);
      this.onComplete(summary);

      // Save to history
      this._saveHistory();
    }
  }

  async _processTabUrl(url) {
    try {
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await this._randomDelay(2000, 4000);
    } catch (e) {
      this._log('error', `Failed to load ${url}: ${e.message}`);
      return;
    }

    // Check if this is a listing page or a direct job page
    const jobs = await this.jobNavigator.findJobPostings(this.page);

    if (jobs.length > 0) {
      this._log('info', `📃 Found ${jobs.length} job postings on this page`);
      await this._processJobListings(jobs);
    } else {
      // Might be a direct job page
      this._log('info', '📄 No job list found — treating as a direct job page');
      await this._processDirectJob();
    }
  }

  async _processJobListings(jobs) {
    for (let i = 0; i < jobs.length; i++) {
      if (this._shouldStop || this.appliedCount >= this.limit) break;
      await this._waitIfPaused();

      const job = jobs[i];
      this._log('info', `\n[${this.appliedCount + 1}/${this.limit}] 📝 ${job.title} at ${job.company}`);
      this._updateProgress();

      try {
        // Open the job
        const opened = await this.jobNavigator.clickJobCard(this.page, job);
        if (!opened) {
          this._log('warn', `⚠️ Could not open job: ${job.title}`);
          this.skippedCount++;
          continue;
        }

        await this._randomDelay(1500, 3000);

        // Try to apply
        const applied = await this._tryApply(job);

        if (applied) {
          this.appliedCount++;
          this._log('success', `✅ Applied to: ${job.title}`);
        } else {
          this.skippedCount++;
          this._log('warn', `⏭️ Skipped: ${job.title}`);
        }

        // Navigate back to listing
        await this.page.goBack();
        await this._randomDelay(1500, 3000);

      } catch (error) {
        this.failedCount++;
        this._log('error', `❌ Error with ${job.title}: ${error.message}`);

        // Try to go back
        try {
          await this.page.goBack();
          await this._randomDelay(1000, 2000);
        } catch (e) { /* ignore */ }
      }

      this._updateProgress();

      // Rate limiting delay
      const delay = this.settings.delayBetweenApply || 3000;
      await this._randomDelay(delay, delay + 2000);
    }

    // Try next page if limit not reached
    if (this.appliedCount < this.limit && !this._shouldStop) {
      this._log('info', '📄 Checking for next page...');
      const hasNext = await this.jobNavigator.goToNextPage(this.page);
      if (hasNext) {
        this._log('info', '➡️ Moving to next page');
        await this._randomDelay(2000, 4000);
        const nextJobs = await this.jobNavigator.findJobPostings(this.page);
        if (nextJobs.length > 0) {
          await this._processJobListings(nextJobs);
        }
      }
    }
  }

  async _processDirectJob() {
    try {
      const applied = await this._tryApply({ title: 'Direct Job', company: 'Unknown' });
      if (applied) {
        this.appliedCount++;
        this._log('success', '✅ Applied to direct job');
      } else {
        this.skippedCount++;
        this._log('warn', '⏭️ Could not apply to this page');
      }
    } catch (error) {
      this.failedCount++;
      this._log('error', `❌ Error: ${error.message}`);
    }
    this._updateProgress();
  }

  async _tryApply(job) {
    // Step 1: Check for inline form
    const hasForm = await this.jobNavigator.hasInlineForm(this.page);

    if (!hasForm) {
      // Try clicking "Apply" button first
      const clickedApply = await this.jobNavigator.clickApplyButton(this.page);
      if (!clickedApply) {
        this._log('warn', 'No apply button or form found');
        return false;
      }

      // Wait for form to appear or new page
      await this._randomDelay(2000, 4000);
    }

    // Step 2: Extract job description for AI context
    const descriptionText = await this.jobNavigator.extractJobDescription(this.page);
    let jobContext = {
      title: job.title || 'Unknown',
      company: job.company || 'Unknown',
      description: descriptionText.substring(0, 2000)
    };

    // Optionally summarize with AI
    if (this.aiService) {
      try {
        const summary = await this.aiService.summarizeJobDescription(descriptionText);
        jobContext = { ...jobContext, ...summary };
      } catch (e) {
        // Use raw description as fallback
      }
    }

    // Step 3: Fill the form
    this._log('info', '📝 Filling form fields...');
    const fillResult = await this.formFiller.fillForm(this.page, jobContext, this.profile);

    this._log('info', `  ✏️ Profile filled: ${fillResult.filledCount} | AI filled: ${fillResult.aiFilledCount} | Skipped: ${fillResult.skippedCount}`);

    if (fillResult.errors.length > 0) {
      fillResult.errors.forEach(err => this._log('warn', `  ⚠️ ${err}`));
    }

    // Step 4: Submit if auto-submit is on
    if (this.settings.autoSubmit !== false) {
      this._log('info', '📤 Submitting application...');
      const submitted = await this.jobNavigator.clickSubmitButton(this.page);
      if (submitted) {
        await this._randomDelay(2000, 3000);
        return true;
      } else {
        this._log('warn', 'Could not find submit button');
        return fillResult.filledCount > 0; // Partial success
      }
    }

    return fillResult.filledCount > 0;
  }

  pause() {
    this.isPaused = true;
    this._log('info', '⏸️ Engine paused');
  }

  resume() {
    this.isPaused = false;
    this._log('info', '▶️ Engine resumed');
  }

  stop() {
    this._shouldStop = true;
    this.isPaused = false;
    this._log('info', '🛑 Engine stopping...');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      appliedCount: this.appliedCount,
      failedCount: this.failedCount,
      skippedCount: this.skippedCount,
      limit: this.limit,
      logs: this.logs.slice(-50) // Last 50 logs
    };
  }

  // ─── Private Helpers ───

  async _waitIfPaused() {
    while (this.isPaused && !this._shouldStop) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  async _randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min) + min);
    await new Promise(r => setTimeout(r, delay));
  }

  _log(level, message) {
    const log = {
      level,
      message,
      timestamp: new Date().toISOString()
    };
    this.logs.push(log);
    this.onLog(log);
    console.log(`[${level.toUpperCase()}] ${message}`);
  }

  _updateProgress() {
    this.onProgress({
      applied: this.appliedCount,
      failed: this.failedCount,
      skipped: this.skippedCount,
      limit: this.limit,
      percentage: Math.round((this.appliedCount / this.limit) * 100)
    });
  }

  _saveHistory() {
    const history = this.store.get('applicationHistory', []);
    history.push({
      date: new Date().toISOString(),
      applied: this.appliedCount,
      failed: this.failedCount,
      skipped: this.skippedCount,
      urls: this.tabUrls,
      logs: this.logs.slice(-100)
    });
    // Keep last 50 sessions
    if (history.length > 50) history.splice(0, history.length - 50);
    this.store.set('applicationHistory', history);
  }
}

module.exports = { ApplyLoop };
