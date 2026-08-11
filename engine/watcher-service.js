const crypto = require("crypto");
const path = require("path");
const { fork } = require("child_process");
const Store = require("electron-store");
const { ATSPoller } = require("./ats-poller");
const { AIService } = require("./ai-service");

/**
 * WatcherService — Real-time Direct-Source Job Watcher Background Daemon
 * Features:
 * - Separate watcher_db.json store to keep main config.json light & fast
 * - Instant job persistence & real-time store streaming
 * - Content hashing & deduplication (company + title + location + url)
 * - Real-time Change Detection (new vs closed listings)
 * - AI Relevance Filter & Scoring via Gemini API
 * - Background Polling Timer with manual trigger & retry backoff
 */
class WatcherService {
  constructor(store, profileStore) {
    this.mainStore = store;
    this.profileStore = profileStore;
    // Separate storage file for job watcher to prevent bloating main config.json
    this.dbStore = new Store({ name: "watcher_db" });
    this.atsPoller = new ATSPoller();
    this.pollIntervalMs = 3 * 60 * 1000; // 3 minutes default
    // Give Electron and the renderer time to finish startup before doing network
    // and synchronous electron-store work.
    this.startupDelayMs = 15000;
    // electron-store writes are synchronous and pollCompany performs a
    // read/modify/write cycle. Serialize them to avoid lost postings and
    // reduce disk/CPU spikes on machines with many watched companies.
    this.pollConcurrency = 1;
    this.timer = null;
    this.initialPollTimer = null;
    this.started = false;
    this.worker = null;
    this.workerPoll = null;
    this.isPolling = false;
    this.listeners = new Set();
    this.companies = this.dbStore.get("companies") || [];
    this.postings = this.dbStore.get("postings") || {};

    // Initialize seed companies in watcher_db.json
    this._initSeedCompanies();
  }

  _initSeedCompanies() {
    const seeds = this.atsPoller.getSeedCompanies().map((c) => ({
      ...c,
      active: true,
      lastChecked: null,
      jobCount: 0
    }));

    // Do not overwrite a user's company list on every application start.
    if (!this.companies.length) {
      this.companies = seeds;
      this.dbStore.set("companies", this.companies);
    }
  }

  /**
   * Register event listener for live updates
   */
  onUpdate(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notifyListeners(event, data) {
    for (const cb of this.listeners) {
      try { cb(event, data); } catch (e) {}
    }
  }

  /**
   * Start the background polling loop
   */
  start() {
    if (this.started) return;
    this.started = true;
    console.log(`⚡ Direct Job Watcher Daemon started (${this.pollIntervalMs / 60000}-min interval)`);
    
    // Avoid making the app compete with Electron startup for CPU, disk and
    // network resources. The first scan can still be started manually.
    this.initialPollTimer = setTimeout(() => {
      this.initialPollTimer = null;
      this.pollAllCompanies().catch((err) => {
        console.error("Initial watcher poll failed:", err.message);
      });
    }, this.startupDelayMs);
    this.initialPollTimer.unref?.();

    this.timer = setInterval(() => {
      this.pollAllCompanies().catch((err) => {
        console.error("Scheduled watcher poll failed:", err.message);
      });
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    this.started = false;
    if (this.initialPollTimer) {
      clearTimeout(this.initialPollTimer);
      this.initialPollTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("🛑 Direct Job Watcher Daemon stopped");
    }
    if (this.worker) {
      this.worker.kill();
      this.worker = null;
    }
    if (this.workerPoll) {
      this.workerPoll.reject(new Error("Watcher stopped"));
      this.workerPoll = null;
    }
  }

  /**
   * Get target companies list
   */
  getCompanies() {
    return this.companies;
  }

  /**
   * Add a new target company to watch
   */
  addCompany(companyInput) {
    const companies = this.getCompanies();
    const detected = this.atsPoller.detectATS(companyInput.url || companyInput.domain || companyInput.name);

    const id = (companyInput.name || detected.boardToken || "company")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    const newCompany = {
      id: id || `comp_${Date.now()}`,
      name: companyInput.name || detected.boardToken || "Custom Company",
      domain: companyInput.domain || "",
      careerUrl: companyInput.url || "",
      atsType: companyInput.atsType || detected.atsType,
      boardToken: companyInput.boardToken || detected.boardToken,
      workdayTenant: companyInput.workdayTenant || detected.workdayTenant || "",
      workdaySite: companyInput.workdaySite || detected.workdaySite || "",
      active: true,
      lastChecked: null,
      jobCount: 0
    };

    const existingIdx = companies.findIndex((c) => c.id === id || c.domain === companyInput.domain);
    if (existingIdx >= 0) {
      companies[existingIdx] = { ...companies[existingIdx], ...newCompany };
    } else {
      companies.push(newCompany);
    }

    this.companies = companies;
    this.dbStore.set("companies", this.companies);
    this._notifyListeners("companies-changed", companies);

    return newCompany;
  }

  /**
   * Toggle active state of a company
   */
  toggleCompany(companyId, active) {
    const companies = this.getCompanies();
    const comp = companies.find((c) => c.id === companyId);
    if (comp) {
      comp.active = typeof active === "boolean" ? active : !comp.active;
      this.companies = companies;
      this.dbStore.set("companies", this.companies);
      this._notifyListeners("companies-changed", companies);
    }
    return companies;
  }

  /**
   * Delete target company
   */
  removeCompany(companyId) {
    let companies = this.getCompanies();
    companies = companies.filter((c) => c.id !== companyId);
    this.companies = companies;
    this.dbStore.set("companies", this.companies);
    this._notifyListeners("companies-changed", companies);
    return companies;
  }

  /**
   * Compute MD5 content hash for a job posting
   */
  _hashPosting(posting) {
    const str = `${(posting.company || "").toLowerCase()}_${(posting.title || "").toLowerCase()}_${(posting.location || "").toLowerCase()}_${posting.url || ""}`;
    return crypto.createHash("md5").update(str).digest("hex");
  }

  /**
   * Get stored job postings with optional filtering
   */
  getPostings(filter = {}) {
    const postingsMap = this.postings;
    let list = Object.values(postingsMap);

    const { minScore = 0, status = "queue", company = "", search = "", atsType = "", locationFilter = "", categoryFilter = "", limit = 0, offset = 0 } = filter;

    list = list.filter((item) => {
      // Status filter
      if (status === "queue" && (item.status === "dismissed" || item.status === "closed")) return false;
      if (status === "active" && (item.status === "dismissed" || item.status === "closed")) return false;
      if (status === "applied" && item.status !== "applied") return false;
      if (status === "closed" && item.status !== "closed") return false;
      if (status === "dismissed" && item.status !== "dismissed") return false;

      // Score threshold
      if (minScore > 0 && (item.relevanceScore || 0) < minScore) return false;

      // ATS filter
      if (atsType && item.atsType !== atsType) return false;

      // Company filter
      if (company && item.company.toLowerCase() !== company.toLowerCase()) return false;

      // Location filter
      if (locationFilter) {
        const loc = (item.location || "").toLowerCase();
        if (locationFilter === "remote" && !loc.includes("remote")) return false;
        if (locationFilter === "india" && !loc.includes("india") && !loc.includes("in") && !loc.includes("bengaluru") && !loc.includes("bangalore") && !loc.includes("mumbai") && !loc.includes("delhi") && !loc.includes("hyderabad") && !loc.includes("pune")) return false;
        if (locationFilter === "us" && !loc.includes("united states") && !loc.includes("us") && !loc.includes("sf") && !loc.includes("san francisco") && !loc.includes("ny") && !loc.includes("new york") && !loc.includes("ca")) return false;
        if (locationFilter === "europe" && !loc.includes("uk") && !loc.includes("london") && !loc.includes("germany") && !loc.includes("berlin") && !loc.includes("france") && !loc.includes("paris") && !loc.includes("europe") && !loc.includes("eu")) return false;
      }

      // Category filter
      if (categoryFilter) {
        const title = (item.title || "").toLowerCase();
        const dept = (item.department || "").toLowerCase();
        if (categoryFilter === "engineering") {
          const isEng = title.includes("engineer") || title.includes("developer") || title.includes("full stack") || title.includes("backend") || title.includes("frontend") || title.includes("software") || dept.includes("engineering");
          if (!isEng) return false;
        }
        if (categoryFilter === "ai") {
          const isAI = title.includes("ai") || title.includes("machine learning") || title.includes("ml") || title.includes("data science") || title.includes("data scientist") || title.includes("researcher");
          if (!isAI) return false;
        }
        if (categoryFilter === "product") {
          const isProd = title.includes("product manager") || title.includes("product lead") || title.includes("pm") || dept.includes("product");
          if (!isProd) return false;
        }
        if (categoryFilter === "design") {
          const isDesign = title.includes("design") || title.includes("ux") || title.includes("ui") || title.includes("brand") || dept.includes("design");
          if (!isDesign) return false;
        }
        if (categoryFilter === "sales") {
          const isSales = title.includes("sales") || title.includes("account executive") || title.includes("growth") || title.includes("marketing") || dept.includes("sales");
          if (!isSales) return false;
        }
      }

      // Search term
      if (search) {
        const q = search.toLowerCase();
        const tMatch = (item.title || "").toLowerCase().includes(q);
        const cMatch = (item.company || "").toLowerCase().includes(q);
        const lMatch = (item.location || "").toLowerCase().includes(q);
        if (!tMatch && !cMatch && !lMatch) return false;
      }

      return true;
    });

    // Sort by AI score descending, then newest first
    list.sort((a, b) => {
      if ((b.relevanceScore || 0) !== (a.relevanceScore || 0)) {
        return (b.relevanceScore || 0) - (a.relevanceScore || 0);
      }
      return new Date(b.firstSeen) - new Date(a.firstSeen);
    });
    const total = list.length;
    return limit > 0 ? { items: list.slice(offset, offset + limit), total } : list;
  }

  /**
   * Mark posting as Applied
   */
  markApplied(postingId) {
    const postingsMap = this.postings;
    if (postingsMap[postingId]) {
      postingsMap[postingId].status = "applied";
      postingsMap[postingId].appliedAt = new Date().toISOString();
      this.dbStore.set("postings", this.postings);
      this._notifyListeners("postings-changed", this.getStats());
    }
  }

  /**
   * Dismiss posting from queue
   */
  dismissPosting(postingId) {
    const postingsMap = this.postings;
    if (postingsMap[postingId]) {
      postingsMap[postingId].status = "dismissed";
      this.dbStore.set("postings", this.postings);
      this._notifyListeners("postings-changed", this.getStats());
    }
  }

  /**
   * Get radar overview stats
   */
  getStats() {
    const companies = this.getCompanies();
    const postingsMap = this.postings;
    const list = Object.values(postingsMap);

    const activeCompanies = companies.filter((c) => c.active).length;
    const totalJobsScanned = list.length;
    const queueCount = list.filter((p) => p.status !== "dismissed" && p.status !== "closed" && (p.relevanceScore || 0) >= 60).length;
    const appliedCount = list.filter((p) => p.status === "applied").length;
    const topMatchesCount = list.filter((p) => (p.relevanceScore || 0) >= 75 && p.status !== "dismissed").length;

    return {
      activeCompanies,
      totalCompanies: companies.length,
      totalJobsScanned,
      queueCount,
      appliedCount,
      topMatchesCount,
      isPolling: this.isPolling,
      lastPolledAt: this.lastPolledAt || null
    };
  }

  /**
   * Poll a single company and immediately stream results to watcher_db.json
   */
  async pollCompany(company) {
    if (!company || !company.active) return [];

    const fetchedJobs = await this.atsPoller.fetchJobsForCompany(company);
    this._persistFetchedJobs(company, fetchedJobs);
    return fetchedJobs;
  }

  _persistFetchedJobs(company, fetchedJobs) {
    const postingsMap = this.postings;

    for (const job of fetchedJobs) {
      const hash = this._hashPosting(job);
      const existing = postingsMap[hash];

      if (!existing) {
        postingsMap[hash] = {
          id: hash,
          hash,
          company: job.company,
          title: job.title,
          location: job.location,
          department: job.department,
          url: job.url,
          atsType: job.atsType,
          contentSnippet: job.contentSnippet || "",
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          status: "new",
          relevanceScore: 75,
          verdict: "GOOD",
          reason: `Surfaced directly from ${company.name} [${(job.atsType || "ats").toUpperCase()}] portal.`,
          keyMatchingSkills: []
        };
      } else {
        existing.lastSeen = new Date().toISOString();
        if (existing.status === "closed") {
          existing.status = "new";
        }
      }
    }

    // Update company checked time and count
    const companies = this.getCompanies();
    const targetComp = companies.find((c) => c.id === company.id);
    if (targetComp) {
      targetComp.lastChecked = new Date().toISOString();
      targetComp.jobCount = fetchedJobs.length;
      this.companies = companies;
    }

    this._notifyListeners("postings-changed", this.getStats());
  }

  /**
   * Run full poll across all active target companies
   */
  async pollAllCompanies() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.lastPolledAt = new Date().toISOString();
    this._notifyListeners("status-changed", this.getStats());

    const companies = this.getCompanies().filter((c) => c.active);
    console.log(`🚀 Direct Watcher: Scanning ${companies.length} target company ATS endpoints...`);

    try {
      await this._pollInWorker(companies);

      // Flush once per scan instead of rewriting a multi-megabyte JSON file
      // after every company.
      this.dbStore.set("companies", this.companies);
      this.dbStore.set("postings", this.postings);
      console.log(`✅ Direct Watcher: Poll completed across ${companies.length} targets. Total jobs: ${Object.keys(this.postings).length}`);
      this._notifyListeners("poll-completed", this.getStats());
    } catch (err) {
      console.error("Direct watcher poll failed:", err.message);
      this._notifyListeners("poll-error", { ...this.getStats(), error: err.message });
    } finally {
      this.isPolling = false;
      this._notifyListeners("status-changed", this.getStats());
    }
  }

  _pollInWorker(companies) {
    if (!this.worker || this.worker.killed) {
      this.worker = fork(path.join(__dirname, "watcher-worker.js"), [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      });
      this.worker.on("message", (message) => {
        try {
          if (message.type === "company") {
            this._persistFetchedJobs(message.company, message.jobs || []);
            this._notifyListeners("batch-completed", this.getStats());
          } else if (message.type === "company-error") {
            console.warn(`Watcher worker failed for ${message.companyId}: ${message.error}`);
          } else if (message.type === "complete") {
            this.workerPoll?.resolve();
            this.workerPoll = null;
          } else if (message.type === "error") {
            this.workerPoll?.reject(new Error(message.error));
            this.workerPoll = null;
          }
        } catch (error) {
          console.error("Watcher result could not be saved:", error.message);
          this.workerPoll?.reject(error);
          this.workerPoll = null;
        }
      });
      this.worker.on("exit", (code) => {
        this.worker = null;
        if (this.workerPoll) {
          this.workerPoll.reject(new Error(`Watcher worker exited (${code})`));
          this.workerPoll = null;
        }
      });
    }

    return new Promise((resolve, reject) => {
      this.workerPoll = { resolve, reject };
      this.worker.send({ type: "poll", companies }, (error) => {
        if (error) {
          this.workerPoll?.reject(error);
          this.workerPoll = null;
        }
      });
    });
  }
}

module.exports = { WatcherService };
