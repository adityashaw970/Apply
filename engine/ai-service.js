const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * AI Service for Job Application Auto-Fill
 * Features:
 * - Multi-key rotation with automatic failover
 * - Intelligent form field answering based on user profile
 * - Job context awareness for better responses
 * - Retry logic with exponential backoff
 */
class AIService {
  constructor(apiKeys) {
    // Accept single key (string) or array of keys or comma-separated string
    if (typeof apiKeys === "string") {
      this.keys = apiKeys
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    } else if (Array.isArray(apiKeys)) {
      this.keys = apiKeys.filter(Boolean);
    } else {
      this.keys = [];
    }

    this.clients = [];
    this.currentKeyIndex = 0;
    this.initialized = false;
    this.keyHealthStatus = []; // Track which keys are working
  }

  initialize() {
    if (this.keys.length === 0) {
      throw new Error(
        "No Gemini API key configured. Please add at least one API key in Settings.",
      );
    }

    this.clients = this.keys.map((key) => new GoogleGenerativeAI(key));
    this.keyHealthStatus = new Array(this.clients.length).fill(true); // All keys start healthy
    this.initialized = true;

    console.log(
      `✅ AI Service initialized with ${this.clients.length} API key(s)`,
    );
  }

  /**
   * Get next available client with round-robin + health check
   */
  _getNextHealthyClient() {
    if (this.clients.length === 0) {
      throw new Error("No API clients available");
    }

    // Find next healthy key
    let attempts = 0;
    while (attempts < this.clients.length) {
      const index = (this.currentKeyIndex + attempts) % this.clients.length;

      if (this.keyHealthStatus[index]) {
        this.currentKeyIndex = (index + 1) % this.clients.length;
        return { client: this.clients[index], index };
      }

      attempts++;
    }

    // If all keys are unhealthy, reset health status and try again
    console.log("⚠️ All keys marked unhealthy, resetting health status...");
    this.keyHealthStatus.fill(true);
    return { client: this.clients[0], index: 0 };
  }

  /**
   * Mark a key as unhealthy temporarily
   */
  _markKeyUnhealthy(index) {
    this.keyHealthStatus[index] = false;
    console.log(`⚠️ Key #${index + 1} marked as unhealthy`);

    // Auto-recover after 5 minutes
    setTimeout(
      () => {
        this.keyHealthStatus[index] = true;
        console.log(`✅ Key #${index + 1} health status recovered`);
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Main method: Answer form questions using user profile and job context
   * @param {Array} questions - Array of unanswered questions {label, type, options}
   * @param {Object} jobContext - {title, company, description, requirements, location}
   * @param {Object} userProfile - Complete user profile data
   * @param {String} pageUrl - URL of the page for website context
   * @returns {Array} - Array of {label, answer, error}
   */
  async answerQuestions(questions, jobContext, userProfile, pageUrl) {
    if (!this.initialized) this.initialize();

    if (!questions || questions.length === 0) {
      return [];
    }

    // 🚫 CRITICAL: Filter out work experience questions if user has no work experience data
    const hasWorkExperience =
      Array.isArray(userProfile?.workExperiences) &&
      userProfile.workExperiences.length > 0;
    const filteredQuestions = [];
    const skippedWorkExperienceQuestions = [];

    if (!hasWorkExperience) {
      for (const q of questions) {
        if (this._isWorkExperienceQuestion(q)) {
          console.log(
            `⏭️  Skipping work experience question: "${q.label}" (no work experience data)`,
          );
          skippedWorkExperienceQuestions.push(q);
        } else {
          filteredQuestions.push(q);
        }
      }

      // If we skipped any questions, log it
      if (skippedWorkExperienceQuestions.length > 0) {
        console.log(
          `⏭️  Skipped ${skippedWorkExperienceQuestions.length} work experience question(s)`,
        );
      }
    } else {
      filteredQuestions.push(...questions);
    }

    // If all questions were work experience related, return empty N/A answers
    if (filteredQuestions.length === 0) {
      return questions.map((q) => ({
        label: q.label,
        answer: "N/A",
        error: "Skipped - No work experience in profile",
      }));
    }

    const prompt = this._buildPrompt(
      filteredQuestions,
      jobContext,
      userProfile,
      pageUrl,
    );

    // Model priority list — use gemini-2.5-flash-lite as primary (most stable for Q&A)
    const MODEL_PRIORITY = [
      "gemini-2.5-flash-lite", // Primary: Most stable and reliable for structured answers
      "gemini-2.5-flash", // Fallback: More capable but sometimes verbose
      "gemini-3-flash-preview", // Last resort: Newest but may have different behavior
    ];

    // Try each healthy key until one works
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const { client, index } = this._getNextHealthyClient();

      // Try each model for this key
      for (const modelName of MODEL_PRIORITY) {
        try {
          console.log(
            `🤖 Trying AI key #${index + 1} model=${modelName} for ${filteredQuestions.length} question(s)...`,
          );

          if (attempt === 0 && modelName === MODEL_PRIORITY[0]) {
            console.log(`🤖 ═══ AI REQUEST PAYLOAD ═══`);
            console.log(
              `📋 Questions (${filteredQuestions.length}):`,
              JSON.stringify(filteredQuestions, null, 2),
            );
            console.log(
              `📝 Job Context:`,
              JSON.stringify(
                {
                  ...jobContext,
                  description: jobContext?.description
                    ? jobContext.description.substring(0, 150) +
                      "... [TRUNCATED]"
                    : "",
                },
                null,
                2,
              ),
            );
            console.log(`📨 Full Prompt Length: ${prompt.length} chars`);
            console.log(`═══ END AI PAYLOAD ═══\n`);
          }

          const model = client.getGenerativeModel({
            model: modelName,
            systemInstruction:
              "You are a precise job application answering assistant. You MUST answer EVERY question with a structured JSON response. Return ONLY valid JSON. No markdown. No explanations. Complete all questions.",
          });

          const chat = model.startChat({
            history: [],
            generationConfig: {
              maxOutputTokens: 4096, // More tokens to ensure complete responses
              temperature: 0.1, // Lower temp for more consistent, structured output
              topP: 0.9,
              topK: 10,
            },
          });

          const result = await chat.sendMessage([{ text: prompt }]);

          const responseText =
            result.response?.candidates?.[0]?.content?.parts
              ?.map((p) => p.text)
              ?.join("") || result.response.text();

          // Log response preview
          console.log(
            `\n🤖 AI Response Preview (${responseText.length} chars):\n${responseText.substring(0, 300)}...\n`,
          );

          if (attempt > 0 || modelName !== MODEL_PRIORITY[0]) {
            console.log(
              `✅ Successfully used AI key #${index + 1} model=${modelName}`,
            );
          }

          // Parse and return answers
          const aiAnswers = this._parseResponse(
            responseText,
            filteredQuestions,
          );

          // Validate we got complete answers
          const filledAnswers = aiAnswers.filter(
            (a) => a.answer && a.answer.trim(),
          ).length;
          if (filledAnswers < filteredQuestions.length) {
            console.warn(
              `⚠️ Only got ${filledAnswers}/${filteredQuestions.length} answers. Retrying...`,
            );
            // Continue to next model/key to try again
            continue;
          }

          // Map answers back to original questions (including skipped work experience ones)
          const answers = this._mapAnswersToOriginalQuestions(
            questions,
            aiAnswers,
            skippedWorkExperienceQuestions,
          );

          return answers;
        } catch (err) {
          const isRateLimit =
            err?.status === 429 ||
            err?.message?.includes("429") ||
            err?.message?.includes("RESOURCE_EXHAUSTED") ||
            err?.message?.includes("quota") ||
            err?.message?.includes("Resource has been exhausted");

          const is503Error =
            err?.status === 503 ||
            err?.message?.includes("503") ||
            err?.message?.includes("high demand") ||
            err?.message?.includes("Service Unavailable");

          const isFetchError =
            err?.message?.includes("Error fetching") ||
            err?.message?.includes("fetch failed") ||
            err?.message?.includes("ECONNRESET") ||
            err?.message?.includes("ENOTFOUND") ||
            err?.message?.includes("ETIMEDOUT");

          const isAuthError =
            err?.status === 401 ||
            err?.status === 403 ||
            err?.message?.includes("API key not valid");

          const isModelError =
            err?.message?.includes("not found") ||
            err?.message?.includes("404") ||
            err?.message?.includes("invalid model") ||
            err?.message?.includes("does not support");

          if (isModelError) {
            // Model not available — try next model in priority list
            console.log(
              `⚠️ Model ${modelName} unavailable for key #${index + 1}, trying next model...`,
            );
            continue; // continue inner loop to try next model
          }

          if (isRateLimit || is503Error) {
            let errorType = isRateLimit
              ? "rate limited"
              : "503 service overloaded";
            console.log(
              `⚠️ Gemini key #${index + 1}/${this.clients.length} model=${modelName} ${errorType} - trying next key...`,
            );
            this._markKeyUnhealthy(index);
            break; // break inner (model) loop, try next key
          }

          if (isFetchError) {
            console.log(
              `⚠️ Gemini key #${index + 1}/${this.clients.length} model=${modelName} fetch failed - trying next model...`,
            );
            // Don't mark key unhealthy for fetch errors — could be transient or model-specific
            // Just try next model in the list
            continue; // continue inner (model) loop
          }

          if (isAuthError) {
            console.error(
              `❌ API key #${index + 1} authentication failed. Error: ${err.message}`,
            );
            this._markKeyUnhealthy(index);
            break; // break inner loop, skip this key entirely
          }

          // For other errors, log and try next model
          console.error(
            `⚠️ AI error with key #${index + 1} model=${modelName}:`,
            err.message,
          );
          continue; // try next model
        }
      } // end model loop
    } // end key loop

    // All keys and models exhausted — use intelligent fallback
    console.error(
      "❌ All API keys/models exhausted, generating intelligent fallback answers",
    );
    return questions.map((q) => ({
      label: q.label,
      answer:
        `[AI Fallback] ` +
        this._generateFallbackAnswer(q, userProfile, jobContext),
      error: "AI service unavailable - using fallback",
    }));
  }

  /**
   * Strip HTML tags and clean up noisy text from page scrapes
   */
  _cleanDescription(rawDesc) {
    if (!rawDesc) return "";
    let text = rawDesc;
    // Remove <script>, <style>, <noscript> blocks entirely
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "");
    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, " ");
    // Remove FB_PUBLIC_LOAD_DATA_ and any JavaScript variable dumps
    text = text.replace(/var\s+FB_PUBLIC_LOAD_DATA_[\s\S]*/gi, "");
    text = text.replace(/\{"[a-zA-Z_]+"\s*:\s*[\s\S]{200,}/g, ""); // Remove large JSON blobs
    // Remove Google Forms boilerplate
    text = text.replace(
      /Never submit passwords through Google Forms[\s\S]*/gi,
      "",
    );
    text = text.replace(
      /This content is neither created nor endorsed by Google[\s\S]*/gi,
      "",
    );
    text = text.replace(
      /JavaScript isn't enabled in your browser[^.]*\./gi,
      "",
    );
    text = text.replace(/Enable and reload\./gi, "");
    text = text.replace(/Terms of Service.*Privacy Policy/gi, "");
    text = text.replace(/Does this form look suspicious\?.*$/gim, "");
    text = text.replace(/Report\s*Forms?/gi, "");
    text = text.replace(/Help and feedback/gi, "");
    text = text.replace(/Switch account/gi, "");
    // Remove email addresses that appear in boilerplate (like "form will record your email")
    text = text.replace(
      /The name, email, and photo associated with your Google account will be recorded[^.]*\./gi,
      "",
    );
    // Clean up whitespace
    text = text.replace(/&nbsp;/g, " ");
    text = text.replace(/&amp;/g, "&");
    text = text.replace(/&lt;/g, "<");
    text = text.replace(/&gt;/g, ">");
    text = text.replace(/&#\d+;/g, "");
    text = text.replace(/\s+/g, " ").trim();
    // If after cleaning the text is too short or just noise, return empty
    if (text.length < 20) return "";
    return text.substring(0, 2000);
  }

  /**
   * Build a comprehensive prompt for the AI
   */
  _buildPrompt(questions, jobContext, userProfile, pageUrl) {
    const p = userProfile || {};

    // Extract website domain from URL for context
    let websiteDomain = "Unknown Website";
    if (pageUrl) {
      try {
        const url = new URL(pageUrl);
        websiteDomain = url.hostname.replace("www.", "");
      } catch (e) {
        // Keep default if URL parsing fails
      }
    }

    // Build structured profile summary — only include non-empty, useful fields
    const profileSections = [];

    // 1. Personal Information
    const personalInfo = [];
    const fullName =
      p.fullName || `${p.firstName || ""} ${p.lastName || ""}`.trim();
    if (fullName) personalInfo.push(`Name: ${fullName}`);
    if (p.email) personalInfo.push(`Email: ${p.email}`);

    const fullPhone =
      p.countryCode && p.phone ? `${p.countryCode}${p.phone}` : p.phone;
    if (fullPhone) personalInfo.push(`Phone: ${fullPhone}`);

    const fullAltPhone =
      p.altCountryCode && p.alternatePhone
        ? `${p.altCountryCode}${p.alternatePhone}`
        : p.alternatePhone;
    if (fullAltPhone) personalInfo.push(`Alternate Phone: ${fullAltPhone}`);

    if (p.dateOfBirth) personalInfo.push(`Date of Birth: ${p.dateOfBirth}`);
    if (p.age) personalInfo.push(`Age: ${p.age}`);
    if (p.gender) personalInfo.push(`Gender: ${p.gender}`);

    // // Identity Documents
    // if (p.aadhaarNo) personalInfo.push(`Aadhaar: ${p.aadhaarNo}`);
    // if (p.panNo) personalInfo.push(`PAN Card: ${p.panNo}`);
    // if (p.voterId) personalInfo.push(`Voter ID: ${p.voterId}`);

    // // Bank Details
    // if (p.bankAccountNo) personalInfo.push(`Bank Account Number: ${p.bankAccountNo}`);
    // if (p.ifscCode) personalInfo.push(`IFSC Code: ${p.ifscCode}`);
    // if (p.bankName) personalInfo.push(`Bank Name: ${p.bankName}`);

    const address = [p.address, p.city, p.state, p.pincode, p.country]
      .filter(Boolean)
      .join(", ");
    if (address) personalInfo.push(`Address: ${address}`);
    if (personalInfo.length > 0) {
      profileSections.push(
        `### Personal Information\n${personalInfo.join("\n")}`,
      );
    }

    // 2. Education
    const education = [];
    if (p.degree) education.push(`Degree: ${p.degree}`);
    if (p.branch) education.push(`Major/Branch: ${p.branch}`);
    if (p.collegeName) education.push(`College: ${p.collegeName}`);
    if (p.university) education.push(`University: ${p.university}`);
    if (p.graduationYear)
      education.push(`Graduation Year: ${p.graduationYear}`);
    if (p.cgpa) education.push(`CGPA/GPA: ${p.cgpa}`);
    if (p.percentage) education.push(`Percentage: ${p.percentage}`);
    if (p.tenthPercentage) education.push(`10th Grade: ${p.tenthPercentage}%`);
    if (p.twelfthPercentage)
      education.push(`12th Grade: ${p.twelfthPercentage}%`);
    if (education.length > 0) {
      profileSections.push(`### Education\n${education.join("\n")}`);
    }

    // 3. Professional Experience
    const professional = [];
    if (p.experience) professional.push(`Total Experience: ${p.experience}`);
    if (p.currentCompany)
      professional.push(`Current Company: ${p.currentCompany}`);
    if (p.currentDesignation)
      professional.push(`Current Role: ${p.currentDesignation}`);
    if (p.skills) professional.push(`Skills: ${p.skills}`);
    if (p.currentCTC) professional.push(`Current Salary: ${p.currentCTC}`);
    if (p.expectedCTC) professional.push(`Expected Salary: ${p.expectedCTC}`);
    if (p.noticePeriod) professional.push(`Notice Period: ${p.noticePeriod}`);
    // Work experience entries
    if (Array.isArray(p.workExperiences) && p.workExperiences.length > 0) {
      p.workExperiences.forEach((we, i) => {
        const parts = [];
        if (we.company) parts.push(`Company: ${we.company}`);
        if (we.designationJoining)
          parts.push(`Role at Joining: ${we.designationJoining}`);
        if (we.designationLeaving)
          parts.push(`Role at Leaving: ${we.designationLeaving}`);
        if (we.workCity) parts.push(`City: ${we.workCity}`);
        if (we.workState) parts.push(`State: ${we.workState}`);
        if (we.workCountry) parts.push(`Country: ${we.workCountry}`);
        if (we.sector) parts.push(`Sector: ${we.sector}`);
        if (we.empType) parts.push(`Type: ${we.empType}`);
        if (we.startDate) parts.push(`Start: ${we.startDate}`);
        if (we.endDate) parts.push(`End: ${we.endDate}`);
        if (we.currentlyWorking === "true")
          parts.push(`Currently Working: Yes`);
        if (we.compensation) parts.push(`Compensation: ${we.compensation}`);
        if (we.numMonths) parts.push(`Duration: ${we.numMonths} months`);
        if (parts.length > 0) {
          professional.push(`Work Experience #${i + 1}: ${parts.join(", ")}`);
        }
      });
    }
    if (professional.length > 0) {
      profileSections.push(
        `### Professional Background\n${professional.join("\n")}`,
      );
    }

    // 3b. Availability
    const avail = [];
    if (p.earliestJoinDate)
      avail.push(`Earliest Join Date: ${p.earliestJoinDate}`);
    if (p.availableImmediately)
      avail.push(`Available Immediately: ${p.availableImmediately}`);
    if (p.willingToRelocate)
      avail.push(`Willing to Relocate: ${p.willingToRelocate}`);
    if (p.openToRemote) avail.push(`Open to Remote: ${p.openToRemote}`);
    if (p.openToHybrid) avail.push(`Open to Hybrid: ${p.openToHybrid}`);
    if (p.willingToTravel)
      avail.push(`Willing to Travel: ${p.willingToTravel}`);
    if (p.hasDriversLicense)
      avail.push(`Has Driver's License: ${p.hasDriversLicense}`);
    if (p.driversLicenseId) avail.push(`License ID: ${p.driversLicenseId}`);
    if (avail.length > 0) {
      profileSections.push(
        `### Availability & Preferences\n${avail.join("\n")}`,
      );
    }

    // 4. Additional Information
    const additional = [];
    if (p.languages) additional.push(`Languages: ${p.languages}`);
    if (p.certifications)
      additional.push(`Certifications: ${p.certifications}`);
    if (p.achievements) additional.push(`Achievements: ${p.achievements}`);
    if (p.hobbies) additional.push(`Hobbies: ${p.hobbies}`);
    if (p.aboutMe) additional.push(`About: ${p.aboutMe}`);
    if (p.whyHire) additional.push(`Why Hire Me: ${p.whyHire}`);
    if (p.educationGaps) additional.push(`Education Gaps: ${p.educationGaps}`);
    if (additional.length > 0) {
      profileSections.push(`### Additional Details\n${additional.join("\n")}`);
    }

    // 5. Online Presence
    const links = [];
    if (p.linkedinUrl) links.push(`LinkedIn: ${p.linkedinUrl}`);
    if (p.githubUrl) links.push(`GitHub: ${p.githubUrl}`);
    if (p.portfolioUrl) links.push(`Portfolio: ${p.portfolioUrl}`);
    if (links.length > 0) {
      profileSections.push(`### Online Profiles\n${links.join("\n")}`);
    }

    // 6. Custom Q&A Data
    if (Array.isArray(p.customQA) && p.customQA.length > 0) {
      const qas = p.customQA
        .filter((q) => q.question && q.answer)
        .map((q) => `Q: ${q.question} | A: ${q.answer}`);
      if (qas.length > 0)
        profileSections.push(
          `### Pre-Defined Custom Answers\nMATCH EXACTLY against these if asked:\n${qas.join("\n")}`,
        );
    }

    const profileSummary = profileSections.join("\n\n");

    // Clean job description — remove HTML, scripts, Google Forms boilerplate
    const cleanDesc = this._cleanDescription(jobContext?.description);

    // Build job details section — only include non-empty fields
    const jobParts = [];
    const jobTitle = jobContext?.title || "";
    const jobCompany = jobContext?.company || "";
    const jobLocation = jobContext?.location || "";
    if (jobTitle) jobParts.push(`**Position:** ${jobTitle}`);
    if (jobCompany) jobParts.push(`**Company:** ${jobCompany}`);
    if (jobLocation) jobParts.push(`**Location:** ${jobLocation}`);
    if (cleanDesc) jobParts.push(`**Description:** ${cleanDesc}`);
    if (jobContext?.requirements)
      jobParts.push(
        `**Requirements:** ${jobContext.requirements.substring(0, 300)}`,
      );

    // Build question list with enhanced formatting
    const questionList = questions
      .map((q, i) => {
        let qText = `${i + 1}. "${q.label}"`;
        qText += `\n   Type: ${q.type}`;
        if (q.required) qText += " (REQUIRED)";
        if (q.options && q.options.length > 0) {
          qText += `\n   Available Options: ${q.options.join(" | ")}`;
        }
        return qText;
      })
      .join("\n\n");

    // Build the final prompt — compact and clean
    const skillsList = p.skills
      ? p.skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const skillsStr =
      skillsList.length > 0 ? skillsList.join(", ") : "none listed";

    // Determine highest degree earned for the prompt
    const degreeNorm = (p.highestDegree || p.degree || "").toLowerCase();
    let educationLevel = "Unknown";
    if (degreeNorm.includes("phd") || degreeNorm.includes("doctorate"))
      educationLevel = "PhD";
    else if (
      degreeNorm.includes("master") ||
      degreeNorm.includes("mba") ||
      degreeNorm.includes("m.tech") ||
      degreeNorm.includes("m.sc") ||
      degreeNorm.includes("mca")
    )
      educationLevel = "Masters";
    else if (
      degreeNorm.includes("bachelor") ||
      degreeNorm.includes("b.tech") ||
      degreeNorm.includes("b.e") ||
      degreeNorm.includes("bca") ||
      degreeNorm.includes("bba")
    )
      educationLevel = "Bachelors";
    else if (degreeNorm.includes("diploma")) educationLevel = "Diploma";
    else if (
      degreeNorm.includes("12th") ||
      degreeNorm.includes("high school") ||
      degreeNorm.includes("hsc") ||
      degreeNorm.includes("intermediate")
    )
      educationLevel = "High School";

    // Job preference instruction for unpaid/equity questions
    const jobPref = p.jobPreference || "all";
    const unpaidPrefInstruction =
      jobPref === "paid"
        ? `\n⚠️ IMPORTANT — JOB PREFERENCE: The candidate is set to "ONLY PAID JOBS". If ANY question asks about willingness to work in an unpaid position, no-equity role, volunteer work, or any form of zero/no compensation, you MUST answer "No". This is a hard rule — the candidate will NOT accept unpaid work.\n`
        : `\n⚠️ IMPORTANT — JOB PREFERENCE: The candidate is open to "ALL JOBS" including unpaid internships. If asked whether they are willing to work in an unpaid/no-equity role, answer "Yes".\n`;

    // Today's date — injected so AI can give correct current dates
    const now = new Date();
    const todayYMD = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const todayFmt = now
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      .toUpperCase(); // e.g. 01/APR/2026
    const todayFormatted = `${String(now.getDate()).padStart(2, "0")}/${now.toLocaleString("en", { month: "short" }).toUpperCase()}/${now.getFullYear()}`;

    let prompt = `You are ${fullName || "the candidate"} applying for a job.\nYou must answer the application questions acting AS the candidate in the FIRST PERSON ("I", "my", "me").\nDO NOT talk about the candidate in the third person (e.g., do not say "Aditya has...").\n📅 TODAY'S DATE: ${todayYMD} (${todayFormatted})\n${unpaidPrefInstruction}\n`;

    if (jobParts.length > 0) {
      prompt += `## 🎯 Job Details\n${jobParts.join("\n")}\n\n`;
    }

    prompt += `## 👤 Candidate Profile\n${profileSummary || "(Minimal profile data available)"}\n\n`;
    prompt += `## ❓ Questions to Answer\n${questionList}\n\n`;

    // Add website context for unknown websites
    prompt += `## 🌐 Website Context\n**Application Platform:** ${websiteDomain}\n`;
    prompt += `**Important Note:** This is a ${websiteDomain} job application. The field names and structure may be unique to this platform.\n`;
    prompt += `- Be prepared for non-standard field names that may require interpretation\n`;
    prompt += `- Match field labels to the closest relevant candidate information\n`;
    prompt += `- If a field label is ambiguous, use your best judgment based on context\n\n`;

    prompt += "## 📋 CRITICAL INSTRUCTIONS — CONCISE ANSWERS ONLY\n\n";
    prompt +=
      '**Your Role:** You ARE the candidate. Answer using the candidate\'s actual profile data in FIRST PERSON ("I").\n\n';

    prompt += "## 🔘 RADIO BUTTONS & CHECKBOXES — ESSENTIAL\n";
    prompt += "**For RADIO BUTTONS (pick ONE option):**\n";
    prompt +=
      '- If label contains "Yes," or "Yes, I" → answer "Yes" if the condition applies, "No" otherwise\n';
    prompt +=
      '- If label contains "No," → answer "No" if you select this option\n';
    prompt += "- Examples:\n";
    prompt += '  - Field: "Yes, I am interested" → answer "Yes"\n';
    prompt += '  - Field: "No, I am not interested" → answer "No"\n';
    prompt += '  - Field: "Hourly" → answer "Hourly"\n';
    prompt += '  - Field: "Monthly" → answer "Monthly"\n';
    prompt += '  - Field: "Yes, I can overlap 4 hours" → answer "Yes"\n';
    prompt += '  - Field: "No, I cannot overlap 4 hours" → answer "No"\n\n';
    prompt += "**For CHECKBOXES:**\n";
    prompt +=
      '- If label suggests this SHOULD be checked → answer "Yes" or "Check"\n';
    prompt += '- If label suggests this should NOT be checked → answer "No"\n';
    prompt += "- Example:\n";
    prompt +=
      '  - "I confirm that my data is correct" → answer "Yes" (assume should be checked)\n';
    prompt +=
      '  - "I don\'t have a LinkedIn profile" → answer "No" (if you have one)\n\n';

    prompt += "**ANSWER FORMAT — MANDATORY:**\n";
    prompt +=
      '- **Constraint/Error handling:** If a question label contains "(Constraint/Error: ...)", you MUST strictly follow it. If it says "Enter a whole number", return ONLY the number (e.g. "3" not "3 years").\n';
    prompt +=
      '- **Number/Decimal fields:** Return ONLY the bare number. Example: "3" or "8.5" or "0". If asked for a decimal, DO NOT provide a whole number. If asked for a whole number, DO NOT provide a decimal. If a question asks skill rating and the field expects a decimal (0.0 to 10.0), return ONLY the number like "8.5"\n';
    prompt +=
      '- **Skill rating:** If asked "How good are you at X" with a number field, return a number between 1-10\n';
    prompt +=
      '- **Yes/No questions:** Return ONLY "Yes" or "No". Never say "Yes, I have".\n';
    prompt +=
      '- **Options Provided:** If the question provides "Available Options", YOUR ANSWER MUST BE EXACTLY ONE OF THOSE OPTIONS. Do not hallucinate variants. If no exact match, choose the safest/closest available option.\n';
    prompt += "- **Date fields:** Return ONLY the date in YYYY-MM-DD format\n";
    prompt +=
      '- **Text fields asking for a value** (salary, CTC, years, GPA, etc.): Return ONLY the value. Example: "5 LPA" or "Immediate"\n';
    prompt +=
      '- **Text fields asking for names/URLs:** Return ONLY the value. Example: "John Doe" or "https://github.com/..."\n';
    prompt +=
      '- **Expected compensation / CTC / Salary:** Provide ONLY the numeric value or the explicitly requested format (e.g. "12 LPA"). NEVER write a paragraph or cover letter for compensation questions.\n';
    prompt +=
      '- **Cover letter / "Why hire you" / "Tell about yourself":** 2-3 concise sentences MAX, always in FIRST PERSON. ONLY write a paragraph if the question EXPLICITLY asks for a cover letter or why you are a good fit. Otherwise, NEVER write a paragraph.\n';
    prompt +=
      '- **Languages:** If asked for languages knowing you, state "English" if none are specified in the profile.\n';
    prompt +=
      '- **Generic greeting fields (like "Hello"):** Respond with a brief professional greeting\n';
    prompt +=
      "- **Date / availability questions:** If asked when you can start or complete something, reference TODAY'S DATE: " +
      todayYMD +
      ". Format dates as DD/MON/YY (e.g. " +
      todayFormatted +
      ") unless the question specifies a different format.\n";
    prompt +=
      '- **Language proficiency list questions** (e.g. "List the languages you write and your proficiency"): Format EACH language on its OWN LINE as "Language - Level". Use real line breaks (\\n in JSON becomes a newline). Example answer:\n  TypeScript - Advanced\n  JavaScript - Advanced\n  Python - Advanced\n\n';
    prompt +=
      "⚠️ CRITICAL: Each question MUST receive a UNIQUE answer tailored to THAT specific question.\n";
    prompt += "Never give the same answer to two different questions.\n";
    prompt += `- "What interests you about this company?" → Answer EXACTLY: "I am excited about ${jobCompany || "this company"} because of the opportunity to work on innovative digital products and grow my skills in ${skillsStr}. With ${p.experience ? (String(p.experience).toLowerCase().includes("year") ? p.experience : p.experience + " years") + " of experience" : "relevant experience"}, I believe I can contribute effectively to the team while learning from a dynamic environment."\n`;
    prompt +=
      '- "What is your experience with X?" → Specific experience/years answer\n';
    prompt +=
      '- "Describe a challenge you faced" → Specific story-based answer\n\n';
    prompt +=
      '⚠️ DO NOT write full sentences for value-based questions (like "Language", "Phone", "Age"). If asked "Language", say "English". If asked "How many years...", say "1". NEVER hallucinate a cover letter paragraph into a short text field.\n\n';

    prompt += `## 🛑 SKILL QUESTIONS — VERY IMPORTANT\nThe candidate's EXACT listed skills are: **${skillsStr}**\n`;
    prompt +=
      '- For ANY question asking "Do you know X?" or "Do you have experience with X?" or "Years of experience in X?":\n';
    prompt +=
      "  - If X IS in the skills list: answer positively. Estimate years based on total experience (e.g. if listed as a skill, assume at least 1 year unless profile says otherwise)\n";
    prompt += '  - If X is NOT in the list at all: answer "No" or "0"\n';
    prompt +=
      '  - Do NOT say "0 years" for a skill that IS listed. Use reasonable estimation from profile context.\n';
    prompt +=
      '  - Example: if "Java" is listed and total experience is 3 years, a safe answer is "1-2 years" unless more specific info is available\n\n';

    prompt += `## 🎓 EDUCATION LEVEL\nThe candidate's current/highest education level is: **${educationLevel}** (Degree: ${p.degree || p.highestDegree || "Not specified"})\n`;
    prompt +=
      '- If asked "Do you have a Master\'s degree?" or "Are you a Masters graduate?" and education is NOT Masters or PhD → answer "No"\n';
    prompt +=
      '- If asked about Bachelor\'s and education is only High School/Diploma → answer "No"\n';
    prompt +=
      "- Match education questions STRICTLY to the actual degree earned\n\n";

    prompt += "## 📍 WORK EXPERIENCE LOCATION\n";
    prompt +=
      '- For "Location" or "City" fields INSIDE a Work Experience section, give the CITY WHERE THE JOB WAS LOCATED (not the candidate\'s home address)\n';
    prompt +=
      "- Do NOT put the candidate's personal home address in work experience location fields\n\n";

    prompt += "**NEVER:**\n";
    prompt +=
      '- Say "Not applicable" or "N/A" — always provide a reasonable value\n';
    prompt += "- Leave answers blank or missing\n";
    prompt += "- Write paragraphs for simple value questions\n";
    prompt += "- Mention missing profile data\n";
    prompt += "- Talk in the third person\n\n";

    prompt += "## 🎯 CRITICAL: ANSWER EVERY SINGLE QUESTION\n";
    prompt += `You have **${questions.length} questions** to answer.\n`;
    prompt += "EVERY QUESTION MUST GET AN ANSWER.\n";
    prompt += "DO NOT skip any question.\n";
    prompt +=
      "If unsure, provide your best guess based on the candidate's profile.\n\n";

    prompt += "## 📋 Response Format - EXACT FORMAT REQUIRED\n";
    prompt +=
      "Respond ONLY with a valid JSON array. Do NOT wrap it in markdown code fences.\n";
    prompt +=
      "The array MUST contain EXACTLY " +
      questions.length +
      " objects, one per question.\n\n";
    prompt += "Format:\n";
    prompt +=
      '[\n  {"label": "EXACT question label from above", "answer": "your answer"},\n';
    prompt +=
      '  {"label": "EXACT question label from above", "answer": "your answer"},\n';
    prompt += "  ...(more entries)\n";
    prompt += "]\n\n";
    prompt +=
      "⚠️ CRITICAL: Return exactly " +
      questions.length +
      " entries. No more, no less.";

    return prompt;
  }

  /**
   * Parse AI response into structured answers - extremely robust with multi-level fallbacks
   */
  _parseResponse(responseText, questions) {
    let parsed = null;
    let parseMethod = "none";

    // METHOD 1: Try standard JSON parsing with quote escaping
    try {
      let cleaned = responseText.trim();

      // Remove markdown code fences
      cleaned = cleaned
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      // Try to extract JSON array
      const jsonMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      }

      // Fix trailing commas
      cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

      // Fix unescaped single quotes in labels
      cleaned = cleaned.replace(/"label":\s*"([^"]*)"/g, (match, label) => {
        return `"label":"${label.replace(/'/g, "\\'")}"`;
      });

      // Try to complete truncated strings
      if (!cleaned.endsWith("]")) {
        cleaned = cleaned + "}]";
      }

      parsed = JSON.parse(cleaned);
      parseMethod = "standard JSON";
    } catch (parseError) {
      console.error("❌ Standard JSON parsing failed:", parseError.message);
    }

    // METHOD 2: If standard parsing worked, use it
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`✅ Using ${parseMethod} parser (${parsed.length} answers)`);
      return questions.map((q, i) => {
        const aiAnswer =
          parsed.find(
            (a) =>
              a.label === q.label ||
              (a.label &&
                q.label &&
                a.label.toLowerCase().trim() ===
                  q.label.toLowerCase().trim()) ||
              (a.label &&
                q.label &&
                a.label.toLowerCase().includes(q.label.toLowerCase())) ||
              (q.label &&
                a.label &&
                q.label.toLowerCase().includes(a.label.toLowerCase())),
          ) || parsed[i];

        let finalAnswer = String(aiAnswer?.answer || "").trim();
        // Convert literal backslash-n sequences from AI to actual newlines
        finalAnswer = finalAnswer.replace(/\\n/g, "\n");

        return {
          label: q.label,
          answer: finalAnswer,
          error: null,
        };
      });
    }

    // METHOD 3: Extract using label-answer pairs instead of brute force regex
    console.log("⚠️ Using label-based extraction with improved pattern...");
    const answers = [];

    // Split response into potential label-answer pairs
    const pairs = responseText.split(/\}\s*,\s*\{/);

    for (const pair of pairs) {
      // Extract label
      const labelMatch =
        pair.match(/"label"\s*:\s*"([^"]*(?:\\"[^"]*)*)"/) ||
        pair.match(/"label"\s*:\s*"(.+?)"/);
      const label = labelMatch ? labelMatch[1] : null;

      // Extract answer - more lenient matching
      const answerMatch =
        pair.match(/"answer"\s*:\s*"([^"]*)"/) ||
        pair.match(/"answer"\s*:\s*"?([^",}]+)"?/);
      const answer = answerMatch ? answerMatch[1].trim() : null;

      if (label && answer) {
        answers.push({ label, answer });
      }
    }

    console.log(`⚠️ Label-based extraction found ${answers.length} answers`);

    if (answers.length > 0) {
      return questions.map((q, i) => {
        // Try to find matching answer by label
        let foundAnswer = answers.find(
          (a) =>
            a.label === q.label ||
            a.label.toLowerCase().trim() === q.label.toLowerCase().trim() ||
            a.label.toLowerCase().includes(q.label.toLowerCase()) ||
            q.label.toLowerCase().includes(a.label.toLowerCase()),
        );

        // If not found, use positional matching
        if (!foundAnswer && i < answers.length) {
          foundAnswer = answers[i];
        }

        let finalAnswer = foundAnswer ? foundAnswer.answer : "";
        finalAnswer = String(finalAnswer).replace(/\\n/g, "\n");

        return {
          label: q.label,
          answer: finalAnswer,
          error: foundAnswer ? null : "Unable to extract answer",
        };
      });
    }

    // METHOD 4: Last resort - line by line extraction
    console.log("⚠️ Using line-by-line emergency extraction...");
    const lines = responseText.split("\n");
    const emergencyAnswers = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const answerMatch = line.match(
        /"answer"\s*:\s*"([^"]*)"|answer\s*:\s*"?([^",}]+)"?/,
      );
      if (answerMatch) {
        const answer = (answerMatch[1] || answerMatch[2] || "").trim();
        if (answer && answer.length > 0 && answer.length < 500) {
          // Sanity check
          emergencyAnswers.push(answer);
        }
      }
    }

    console.log(
      `⚠️ Emergency extraction found ${emergencyAnswers.length} answers`,
    );

    // Return with best effort - match answers to questions by position
    return questions.map((q, i) => {
      let finalAnswer = i < emergencyAnswers.length ? emergencyAnswers[i] : "";
      finalAnswer = String(finalAnswer).replace(/\\n/g, "\n");

      return {
        label: q.label,
        answer: finalAnswer,
        error: i < emergencyAnswers.length ? null : "Unable to extract answer",
      };
    });
  }

  /**
   * Generate fallback answer when AI is unavailable
   * Uses profile data to craft meaningful answers for common question types
   */
  _generateFallbackAnswer(question, userProfile, jobContext) {
    const p = userProfile || {};
    const jc = jobContext || {};
    const label = question.label.toLowerCase();
    const fullName =
      p.fullName || `${p.firstName || ""} ${p.lastName || ""}`.trim();

    // Simple keyword matching for common structured fields
    if (
      label.includes("name") &&
      !label.includes("company") &&
      !label.includes("interest")
    ) {
      return fullName || "";
    }
    if (label.includes("email")) return p.email || "";
    if (label.includes("phone") || label.includes("mobile"))
      return p.phone || "";
    if (label.includes("linkedin")) return p.linkedinUrl || "";
    if (label.includes("github")) return p.githubUrl || "";
    if (label.includes("portfolio")) return p.portfolioUrl || "";
    if (
      label.includes("experience") &&
      !label.includes("why") &&
      !label.includes("interest") &&
      !label.includes("tell")
    ) {
      return p.experience || "0";
    }
    if (label.includes("notice")) return p.noticePeriod || "30 days";
    if (label.includes("salary") || label.includes("ctc")) {
      if (label.includes("current")) return p.currentCTC || "";
      if (label.includes("expected")) return p.expectedCTC || "";
      return p.expectedCTC || p.currentCTC || "";
    }
    if (
      label.includes("city") ||
      (label.includes("location") && !label.includes("interest"))
    ) {
      return p.city || "";
    }
    if (label.includes("skill")) return p.skills || "";
    if (label.includes("cgpa") || label.includes("gpa")) return p.cgpa || "";
    if (label.includes("percentage") || label.includes("marks"))
      return p.percentage || "";
    if (label.includes("graduation") || label.includes("passing year"))
      return p.graduationYear || "";
    if (
      label.includes("college") ||
      label.includes("university") ||
      label.includes("institution")
    ) {
      return p.collegeName || p.university || "";
    }
    if (label.includes("degree")) return p.degree || "";
    if (
      label.includes("branch") ||
      label.includes("major") ||
      label.includes("specialization")
    ) {
      return p.branch || "";
    }

    // Open-ended / conversational questions — build a meaningful answer from profile
    const company = jc.company || jc.title || "this company";
    const jobTitle = jc.title || "this position";
    const skills = p.skills || "full-stack development";
    const experienceText = p.experience || "";
    const experience = experienceText
      ? (experienceText.toLowerCase().includes("year")
          ? experienceText
          : `${experienceText} years`) + " of experience"
      : "relevant experience";
    const about = p.aboutMe || p.whyHire || "";

    // "What interests you..." / "Why do you want to work here..." / "Why this company..."
    if (
      label.includes("interest") ||
      label.includes("why") ||
      label.includes("motivat") ||
      label.includes("excit") ||
      label.includes("passion") ||
      label.includes("what draws") ||
      label.includes("why this company")
    ) {
      if (about) {
        return about.substring(0, 500);
      }
      return (
        `I am excited about ${company} because of the opportunity to work on innovative digital products and grow my skills in ${skills}. ` +
        `With ${experience}, I believe I can contribute effectively to the team while learning from a dynamic environment.`
      );
    }

    // "Tell us about yourself" / "Describe yourself" / "About you"
    if (
      label.includes("tell") ||
      label.includes("about you") ||
      label.includes("describe") ||
      label.includes("introduce") ||
      label.includes("background")
    ) {
      if (about) return about.substring(0, 500);
      const degree = p.degree
        ? `${p.degree} in ${p.branch || "Computer Science"}`
        : "a technical background";
      return (
        `I am ${fullName || "a developer"} with ${experience} in ${skills}. ` +
        `I hold ${degree} from ${p.collegeName || "a reputed institution"}. ` +
        `I am passionate about building impactful products and am eager to contribute to ${company}.`
      );
    }

    // "What are your strengths" / "What makes you a good fit"
    if (
      label.includes("strength") ||
      label.includes("good fit") ||
      label.includes("why hire") ||
      label.includes("why should we")
    ) {
      return (
        p.whyHire ||
        `My key strengths are ${skills}. I am a quick learner with ${experience}, and I am committed to delivering quality work. I thrive in collaborative environments and am passionate about ${jobTitle}.`
      );
    }

    // "What are your career goals" / "Where do you see yourself"
    if (
      label.includes("goal") ||
      label.includes("career") ||
      label.includes("future") ||
      label.includes("see yourself")
    ) {
      return (
        `My goal is to grow as a ${jobTitle} and contribute to meaningful projects. ` +
        `I aim to deepen my expertise in ${skills} while taking on increasing responsibilities in a company like ${company}.`
      );
    }

    // "What do you know about us" / "Research about company"
    if (
      label.includes("know about") ||
      label.includes("research") ||
      label.includes("heard about us")
    ) {
      return (
        `I know that ${company} is focused on building innovative digital products and has a strong culture of growth and collaboration. ` +
        `I am excited about the work being done and believe my skills align well with your needs.`
      );
    }

    // For select/radio with options, pick first option
    if (question.options && question.options.length > 0) {
      return question.options[0];
    }

    // For yes/no questions, default to Yes
    if (question.type === "radio" || question.type === "checkbox") {
      return "Yes";
    }

    // Skill check
    if (label.includes("experience with") || label.includes("proficient")) {
      return "0";
    }

    // Generic fallback - keep it concise and context-free to avoid wrong long answers
    return `N/A`;
  }

  /**
   * Detect if a question is about work experience
   * This prevents AI from filling work experience fields if user has no experience
   *
   * ⚠️ NOTE: Returns true for STRONG signals + CONTEXTUAL patterns
   */
  _isWorkExperienceQuestion(question) {
    const label = question.label.toLowerCase();

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
      if (label.includes(indicator)) {
        return true;
      }
    }

    // Also check if label is asking about work-specific details
    if (
      label.includes("work") &&
      (label.includes("experience") ||
        label.includes("history") ||
        label.includes("employment"))
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
      if (indicator.test(label)) {
        return true;
      }
    }

    // CONTEXTUAL: Patterns that only appear in work experience
    if (label.includes("for ") && label.includes("company")) {
      return true;
    }

    if (label.includes("company you") || label.includes("company where")) {
      return true;
    }
  }

  /**
   * Map AI answers back to original questions, including skipped work experience ones
   * @param {Array} originalQuestions - Original questions sent to function (includes skipped)
   * @param {Array} aiAnswers - Answers from AI (only for non-skipped questions)
   * @param {Array} skippedQuestions - Questions skipped because no work experience
   * @returns {Array} - All answers in original question order
   */
  _mapAnswersToOriginalQuestions(
    originalQuestions,
    aiAnswers,
    skippedQuestions,
  ) {
    const result = [];
    const skippedLabels = new Set(skippedQuestions.map((q) => q.label));
    let aiAnswerIndex = 0;

    for (const originalQ of originalQuestions) {
      if (skippedLabels.has(originalQ.label)) {
        // This was a skipped work experience question
        result.push({
          label: originalQ.label,
          answer: "N/A",
          error: "Skipped - No work experience in profile",
        });
      } else {
        // This question was asked to AI, get the answer
        if (aiAnswerIndex < aiAnswers.length) {
          result.push(aiAnswers[aiAnswerIndex]);
          aiAnswerIndex++;
        } else {
          // Should not happen, but handle gracefully
          result.push({
            label: originalQ.label,
            answer: "N/A",
            error: "No answer available",
          });
        }
      }
    }

    return result;
  }

  /**
   * Summarize job description (optional helper)
   */
  async summarizeJobDescription(rawText) {
    if (!this.initialized) this.initialize();

    const prompt = `Extract key information from this job posting. Return ONLY a JSON object with these exact fields:
{
  "title": "job title",
  "company": "company name",
  "description": "2-3 sentence summary",
  "requirements": "comma-separated key requirements",
  "location": "job location"
}

Job Posting:
${rawText.substring(0, 3000)}

Respond with JSON only (no markdown, no code blocks):`;

    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const { client, index } = this._getNextHealthyClient();

      try {
        const model = client.getGenerativeModel({
          model: "gemini-2.5-flash-lite",
        });
        const chat = model.startChat({
          generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
        });
        const result = await chat.sendMessage([{ text: prompt }]);
        const text = result.response
          .text()
          .trim()
          .replace(/```json\s*/gi, "")
          .replace(/```\s*/g, "");

        return JSON.parse(text);
      } catch (error) {
        const isRateLimit =
          error?.status === 429 ||
          error?.message?.includes("RESOURCE_EXHAUSTED");
        const is503 = error?.status === 503 || error?.message?.includes("503");
        const isFetchError = error?.message?.includes("Error fetching");
        if (
          (isRateLimit || is503 || isFetchError) &&
          attempt < this.clients.length - 1
        ) {
          continue;
        }

        if (attempt === this.clients.length - 1) {
          // Return basic fallback
          return {
            title: "Position",
            company: "Company",
            description: rawText.substring(0, 200),
            requirements: "",
            location: "",
          };
        }
      }
    }

    return {
      title: "Unknown",
      company: "Unknown",
      description: rawText.substring(0, 200),
      requirements: "",
      location: "",
    };
  }
}

module.exports = { AIService };
