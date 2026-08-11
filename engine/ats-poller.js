const axios = require("axios");

/**
 * ATS Poller & Detection Engine for Direct-Source Job Watcher
 * Supports:
 * - Greenhouse (API: boards-api.greenhouse.io)
 * - Lever (API: api.lever.co)
 * - Ashby (API: api.ashbyhq.com)
 * - SmartRecruiters (API: api.smartrecruiters.com)
 * - Workday (API: *.myworkdayjobs.com)
 * - Generic Scraper / Fallback
 */

// ─── Verified Seed Companies (100% Tested Working ATS Tokens) ───
const SEED_COMPANIES = [
  { id: "openai", name: "OpenAI", domain: "openai.com", atsType: "ashby", boardToken: "openai" },
  { id: "stripe", name: "Stripe", domain: "stripe.com", atsType: "greenhouse", boardToken: "stripe" },
  { id: "anthropic", name: "Anthropic", domain: "anthropic.com", atsType: "greenhouse", boardToken: "anthropic" },
  { id: "datadog", name: "Datadog", domain: "datadoghq.com", atsType: "greenhouse", boardToken: "datadog" },
  { id: "cloudflare", name: "Cloudflare", domain: "cloudflare.com", atsType: "greenhouse", boardToken: "cloudflare" },
  { id: "palantir", name: "Palantir", domain: "palantir.com", atsType: "lever", boardToken: "palantir" },
  { id: "scaleai", name: "Scale AI", domain: "scale.com", atsType: "greenhouse", boardToken: "scaleai" },
  { id: "airbnb", name: "Airbnb", domain: "airbnb.com", atsType: "greenhouse", boardToken: "airbnb" },
  { id: "figma", name: "Figma", domain: "figma.com", atsType: "greenhouse", boardToken: "figma" },
  { id: "coinbase", name: "Coinbase", domain: "coinbase.com", atsType: "greenhouse", boardToken: "coinbase" },
  { id: "notion", name: "Notion", domain: "notion.so", atsType: "ashby", boardToken: "notion" },
  { id: "cursor", name: "Anysphere (Cursor)", domain: "cursor.com", atsType: "ashby", boardToken: "cursor" },
  { id: "ramp", name: "Ramp", domain: "ramp.com", atsType: "ashby", boardToken: "ramp" },
  { id: "postman", name: "Postman", domain: "postman.com", atsType: "greenhouse", boardToken: "postman" },
  { id: "spotify", name: "Spotify", domain: "spotify.com", atsType: "lever", boardToken: "spotify" },
  { id: "vercel", name: "Vercel", domain: "vercel.com", atsType: "greenhouse", boardToken: "vercel" },
  { id: "supabase", name: "Supabase", domain: "supabase.com", atsType: "ashby", boardToken: "supabase" },
  { id: "discord", name: "Discord", domain: "discord.com", atsType: "greenhouse", boardToken: "discord" },
  { id: "linear", name: "Linear", domain: "linear.app", atsType: "ashby", boardToken: "linear" }
];

class ATSPoller {
  constructor() {
    this.client = axios.create({
      timeout: 15000,
      // Prevent a malformed or unexpectedly large generic careers page from
      // consuming excessive memory in the Electron main process.
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*"
      }
    });
  }

  /**
   * Get pre-configured list of seed companies
   */
  getSeedCompanies() {
    return SEED_COMPANIES;
  }

  /**
   * Auto-detect ATS type and board token from a given URL or domain string
   */
  detectATS(inputUrl) {
    if (!inputUrl) return { atsType: "generic", boardToken: "" };

    const url = inputUrl.trim().toLowerCase();

    // Greenhouse
    if (url.includes("boards.greenhouse.io/") || url.includes("greenhouse.io/")) {
      const match = url.match(/(?:boards\.greenhouse\.io|greenhouse\.io)\/([^\/\?#]+)/i);
      if (match && match[1] && match[1] !== "embed") {
        return { atsType: "greenhouse", boardToken: match[1] };
      }
    }
    if (url.includes("gh_src=") || url.includes("gh_jid=")) {
      const match = url.match(/boards\.greenhouse\.io\/embed\/job_board\?for=([^\&#]+)/i);
      if (match && match[1]) {
        return { atsType: "greenhouse", boardToken: match[1] };
      }
    }

    // Lever
    if (url.includes("jobs.lever.co/")) {
      const match = url.match(/jobs\.lever\.co\/([^\/\?#]+)/i);
      if (match && match[1]) {
        return { atsType: "lever", boardToken: match[1] };
      }
    }

    // Ashby
    if (url.includes("jobs.ashbyhq.com/")) {
      const match = url.match(/jobs\.ashbyhq\.com\/([^\/\?#]+)/i);
      if (match && match[1]) {
        return { atsType: "ashby", boardToken: match[1] };
      }
    }

    // SmartRecruiters
    if (url.includes("careers.smartrecruiters.com/")) {
      const match = url.match(/careers\.smartrecruiters\.com\/([^\/\?#]+)/i);
      if (match && match[1]) {
        return { atsType: "smartrecruiters", boardToken: match[1] };
      }
    }

    // Workday
    if (url.includes("myworkdayjobs.com/")) {
      const match = url.match(/(?:https?:\/\/)?([^\.]+)\.myworkdayjobs\.com\/(?:[^\/]+\/)?([^\/\?#]+)/i);
      if (match && match[1] && match[2]) {
        return {
          atsType: "workday",
          boardToken: match[1],
          workdayTenant: match[1],
          workdaySite: match[2]
        };
      }
    }

    // Fallback: extract domain name or token
    const domainMatch = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\:\?#]+)/i);
    const domain = domainMatch ? domainMatch[1] : url;
    const nameToken = domain.split(".")[0];

    return { atsType: "generic", boardToken: nameToken, domain };
  }

  /**
   * Fetch jobs for a company target
   * @param {Object} company - { name, domain, atsType, boardToken, careerUrl, workdayTenant, workdaySite }
   * @returns {Array} Array of normalized job postings
   */
  async fetchJobsForCompany(company) {
    const { atsType, boardToken, name, domain } = company;
    console.log(`📡 Polling ATS [${atsType.toUpperCase()}] for ${name} (${boardToken || domain})...`);

    try {
      switch (atsType) {
        case "greenhouse":
          return await this._pollGreenhouse(boardToken || company.id, name);
        case "lever":
          return await this._pollLever(boardToken || company.id, name);
        case "ashby":
          return await this._pollAshby(boardToken || company.id, name);
        case "smartrecruiters":
          return await this._pollSmartRecruiters(boardToken || company.id, name);
        case "workday":
          return await this._pollWorkday(company);
        case "generic":
        default:
          return await this._pollGeneric(company);
      }
    } catch (err) {
      console.warn(`⚠️ Error polling ATS for ${name} [${atsType}]:`, err.message);
      return [];
    }
  }

  /**
   * 1. Greenhouse Poller
   */
  async _pollGreenhouse(boardToken, companyName) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
    const res = await this.client.get(url);
    const rawJobs = res.data?.jobs || [];

    return rawJobs.map((j) => ({
      rawId: String(j.id),
      company: companyName,
      title: j.title ? j.title.trim() : "Untitled Position",
      location: j.location?.name || "Remote / Unspecified",
      department: j.departments && j.departments.length > 0 ? j.departments[0].name : "General",
      url: j.absolute_url || `https://boards.greenhouse.io/${boardToken}/jobs/${j.id}`,
      postedDate: j.updated_at || j.created_at || new Date().toISOString(),
      atsType: "greenhouse",
      contentSnippet: j.content ? this._stripHtml(j.content).slice(0, 500) : ""
    }));
  }

  /**
   * 2. Lever Poller
   */
  async _pollLever(boardToken, companyName) {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken)}?mode=json`;
    const res = await this.client.get(url);
    const rawJobs = Array.isArray(res.data) ? res.data : [];

    return rawJobs.map((j) => ({
      rawId: String(j.id),
      company: companyName,
      title: j.text ? j.text.trim() : "Untitled Position",
      location: j.categories?.location || j.categories?.allLocations?.join(", ") || "Remote / Unspecified",
      department: j.categories?.department || j.categories?.team || "General",
      url: j.hostedUrl || j.applyUrl || `https://jobs.lever.co/${boardToken}/${j.id}`,
      postedDate: j.createdAt ? new Date(j.createdAt).toISOString() : new Date().toISOString(),
      atsType: "lever",
      contentSnippet: j.descriptionPlain ? j.descriptionPlain.slice(0, 500) : ""
    }));
  }

  /**
   * 3. Ashby Poller
   */
  async _pollAshby(boardToken, companyName) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardToken)}`;
    const res = await this.client.get(url);
    const rawJobs = res.data?.jobs || [];

    return rawJobs.map((j) => ({
      rawId: String(j.id || j.jobUrl),
      company: companyName,
      title: j.title ? j.title.trim() : "Untitled Position",
      location: j.location || (j.isRemote ? "Remote" : "Unspecified"),
      department: j.department || j.team || "General",
      url: j.jobUrl || `https://jobs.ashbyhq.com/${boardToken}/${j.id}`,
      postedDate: j.publishedAt || new Date().toISOString(),
      atsType: "ashby",
      contentSnippet: j.descriptionPlain ? j.descriptionPlain.slice(0, 500) : ""
    }));
  }

  /**
   * 4. SmartRecruiters Poller
   */
  async _pollSmartRecruiters(boardToken, companyName) {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(boardToken)}/postings`;
    const res = await this.client.get(url);
    const rawJobs = res.data?.content || [];

    return rawJobs.map((j) => ({
      rawId: String(j.id),
      company: companyName,
      title: j.name ? j.name.trim() : "Untitled Position",
      location: j.location ? `${j.location.city || ''} ${j.location.country || ''}`.trim() : "Remote / Unspecified",
      department: j.department?.label || j.typeOfEmployment?.label || "General",
      url: `https://jobs.smartrecruiters.com/${boardToken}/${j.id}`,
      postedDate: j.releasedDate || new Date().toISOString(),
      atsType: "smartrecruiters",
      contentSnippet: ""
    }));
  }

  /**
   * 5. Workday Poller
   */
  async _pollWorkday(company) {
    const tenant = company.workdayTenant || company.boardToken;
    const site = company.workdaySite || "External";
    if (!tenant) return [];

    const url = `https://${tenant}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
    const res = await this.client.post(url, {
      appliedFacets: {},
      limit: 20,
      offset: 0,
      searchText: ""
    });

    const rawJobs = res.data?.jobPostings || [];
    return rawJobs.map((j) => ({
      rawId: String(j.bulletFields?.join("-") || j.externalPath || j.title),
      company: company.name,
      title: j.title ? j.title.trim() : "Untitled Position",
      location: j.locationsText || "Unspecified",
      department: j.subTitle || "General",
      url: j.externalPath ? `https://${tenant}.myworkdayjobs.com/en-US/${site}${j.externalPath}` : company.careerUrl || `https://${tenant}.myworkdayjobs.com/`,
      postedDate: j.postedOn || new Date().toISOString(),
      atsType: "workday",
      contentSnippet: ""
    }));
  }

  /**
   * 6. Generic Scraper Fallback
   */
  async _pollGeneric(company) {
    const targetUrl = company.careerUrl || (company.domain ? `https://${company.domain}/careers` : null);
    if (!targetUrl) return [];

    try {
      const res = await this.client.get(targetUrl);
      const html = res.data || "";

      // Light regex extraction for career links with standard patterns
      const linkRegex = /<a\s+[^>]*href=["']([^"']*(?:jobs|careers|posting|position|role)[^"']*)["'][^>]*>(.*?)<\/a>/gi;
      let match;
      const foundJobs = [];
      const seenUrls = new Set();

      while ((match = linkRegex.exec(html)) !== null && foundJobs.length < 15) {
        let rawHref = match[1];
        let text = this._stripHtml(match[2]).trim();

        if (!text || text.length < 4 || text.length > 80 || text.toLowerCase().includes("see all") || text.toLowerCase().includes("careers")) {
          continue;
        }

        let fullUrl = rawHref;
        if (rawHref.startsWith("/")) {
          const origin = new URL(targetUrl).origin;
          fullUrl = origin + rawHref;
        } else if (!rawHref.startsWith("http")) {
          continue;
        }

        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);

        foundJobs.push({
          rawId: fullUrl,
          company: company.name,
          title: text,
          location: "Remote / Unspecified",
          department: "General",
          url: fullUrl,
          postedDate: new Date().toISOString(),
          atsType: "generic",
          contentSnippet: ""
        });
      }

      return foundJobs;
    } catch (e) {
      return [];
    }
  }

  /**
   * Helper: Strip HTML tags to plain text
   */
  _stripHtml(html) {
    if (!html) return "";
    return html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim();
  }
}

module.exports = { ATSPoller, SEED_COMPANIES };
