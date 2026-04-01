const { GoogleGenerativeAI } = require('@google/generative-ai');

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
    if (typeof apiKeys === 'string') {
      this.keys = apiKeys.split(',').map(k => k.trim()).filter(Boolean);
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
      throw new Error('No Gemini API key configured. Please add at least one API key in Settings.');
    }

    this.clients = this.keys.map(key => new GoogleGenerativeAI(key));
    this.keyHealthStatus = new Array(this.clients.length).fill(true); // All keys start healthy
    this.initialized = true;

    console.log(`✅ AI Service initialized with ${this.clients.length} API key(s)`);
  }

  /**
   * Get next available client with round-robin + health check
   */
  _getNextHealthyClient() {
    if (this.clients.length === 0) {
      throw new Error('No API clients available');
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
    console.log('⚠️ All keys marked unhealthy, resetting health status...');
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
    setTimeout(() => {
      this.keyHealthStatus[index] = true;
      console.log(`✅ Key #${index + 1} health status recovered`);
    }, 5 * 60 * 1000);
  }

  /**
   * Main method: Answer form questions using user profile and job context
   * @param {Array} questions - Array of unanswered questions {label, type, options}
   * @param {Object} jobContext - {title, company, description, requirements, location}
   * @param {Object} userProfile - Complete user profile data
   * @returns {Array} - Array of {label, answer, error}
   */
  async answerQuestions(questions, jobContext, userProfile) {
    if (!this.initialized) this.initialize();

    if (!questions || questions.length === 0) {
      return [];
    }

    const prompt = this._buildPrompt(questions, jobContext, userProfile);

    // Model priority list — try most capable/stable first, fall back on failure
    const MODEL_PRIORITY = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-3-flash-preview'
    ];

    // Try each healthy key until one works
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const { client, index } = this._getNextHealthyClient();

      // Try each model for this key
      for (const modelName of MODEL_PRIORITY) {
        try {
          console.log(`🤖 Trying AI key #${index + 1} model=${modelName} for ${questions.length} question(s)...`);

          if (attempt === 0 && modelName === MODEL_PRIORITY[0]) {
            console.log(`🤖 ═══ AI REQUEST PAYLOAD ═══`);
            console.log(`📋 Questions (${questions.length}):`, JSON.stringify(questions, null, 2));
            console.log(`📝 Job Context:`, JSON.stringify({ ...jobContext, description: jobContext?.description ? jobContext.description.substring(0, 150) + '... [TRUNCATED]' : '' }, null, 2));
            console.log(`📨 Full Prompt Length: ${prompt.length} chars`);
            console.log(`═══ END AI PAYLOAD ═══\n`);
          }

          const model = client.getGenerativeModel({
            model: modelName,
            systemInstruction: 'You are an expert job application assistant helping a candidate apply for a position. Respond ONLY with a JSON array identifying answers for each field.'
          });

          const chat = model.startChat({
            history: [],
            generationConfig: {
              maxOutputTokens: 2048,
              temperature: 0.2,
              topP: 0.95,
              topK: 20
            }
          });

          const result = await chat.sendMessage([{ text: prompt }]);

          const responseText = result.response?.candidates?.[0]?.content?.parts
            ?.map(p => p.text)?.join('') || result.response.text();

          if (attempt > 0 || modelName !== MODEL_PRIORITY[0]) {
            console.log(`✅ Successfully used AI key #${index + 1} model=${modelName}`);
          }

          // Parse and return answers
          return this._parseResponse(responseText, questions);

        } catch (err) {
          const isRateLimit = err?.status === 429 ||
            err?.message?.includes("429") ||
            err?.message?.includes("RESOURCE_EXHAUSTED") ||
            err?.message?.includes("quota") ||
            err?.message?.includes("Resource has been exhausted");

          const is503Error = err?.status === 503 ||
            err?.message?.includes("503") ||
            err?.message?.includes("high demand") ||
            err?.message?.includes("Service Unavailable");

          const isFetchError = err?.message?.includes("Error fetching") ||
            err?.message?.includes("fetch failed") ||
            err?.message?.includes("ECONNRESET") ||
            err?.message?.includes("ENOTFOUND") ||
            err?.message?.includes("ETIMEDOUT");

          const isAuthError = err?.status === 401 ||
            err?.status === 403 ||
            err?.message?.includes('API key not valid');

          const isModelError = err?.message?.includes('not found') ||
            err?.message?.includes('404') ||
            err?.message?.includes('invalid model') ||
            err?.message?.includes('does not support');

          if (isModelError) {
            // Model not available — try next model in priority list
            console.log(`⚠️ Model ${modelName} unavailable for key #${index + 1}, trying next model...`);
            continue; // continue inner loop to try next model
          }

          if (isRateLimit || is503Error) {
            let errorType = isRateLimit ? "rate limited" : "503 service overloaded";
            console.log(`⚠️ Gemini key #${index + 1}/${this.clients.length} model=${modelName} ${errorType} - trying next key...`);
            this._markKeyUnhealthy(index);
            break; // break inner (model) loop, try next key
          }

          if (isFetchError) {
            console.log(`⚠️ Gemini key #${index + 1}/${this.clients.length} model=${modelName} fetch failed - trying next model...`);
            // Don't mark key unhealthy for fetch errors — could be transient or model-specific
            // Just try next model in the list
            continue; // continue inner (model) loop
          }

          if (isAuthError) {
            console.error(`❌ API key #${index + 1} authentication failed. Error: ${err.message}`);
            this._markKeyUnhealthy(index);
            break; // break inner loop, skip this key entirely
          }

          // For other errors, log and try next model
          console.error(`⚠️ AI error with key #${index + 1} model=${modelName}:`, err.message);
          continue; // try next model
        }
      } // end model loop
    } // end key loop

    // All keys and models exhausted — use intelligent fallback
    console.error('❌ All API keys/models exhausted, generating intelligent fallback answers');
    return questions.map(q => ({
      label: q.label,
      answer: `[AI Fallback] ` + this._generateFallbackAnswer(q, userProfile, jobContext),
      error: 'AI service unavailable - using fallback'
    }));
  }

  /**
   * Strip HTML tags and clean up noisy text from page scrapes
   */
  _cleanDescription(rawDesc) {
    if (!rawDesc) return '';
    let text = rawDesc;
    // Remove <script>, <style>, <noscript> blocks entirely
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, ' ');
    // Remove FB_PUBLIC_LOAD_DATA_ and any JavaScript variable dumps
    text = text.replace(/var\s+FB_PUBLIC_LOAD_DATA_[\s\S]*/gi, '');
    text = text.replace(/\{"[a-zA-Z_]+"\s*:\s*[\s\S]{200,}/g, ''); // Remove large JSON blobs
    // Remove Google Forms boilerplate
    text = text.replace(/Never submit passwords through Google Forms[\s\S]*/gi, '');
    text = text.replace(/This content is neither created nor endorsed by Google[\s\S]*/gi, '');
    text = text.replace(/JavaScript isn't enabled in your browser[^.]*\./gi, '');
    text = text.replace(/Enable and reload\./gi, '');
    text = text.replace(/Terms of Service.*Privacy Policy/gi, '');
    text = text.replace(/Does this form look suspicious\?.*$/gim, '');
    text = text.replace(/Report\s*Forms?/gi, '');
    text = text.replace(/Help and feedback/gi, '');
    text = text.replace(/Switch account/gi, '');
    // Remove email addresses that appear in boilerplate (like "form will record your email")
    text = text.replace(/The name, email, and photo associated with your Google account will be recorded[^.]*\./gi, '');
    // Clean up whitespace
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&#\d+;/g, '');
    text = text.replace(/\s+/g, ' ').trim();
    // If after cleaning the text is too short or just noise, return empty
    if (text.length < 20) return '';
    return text.substring(0, 2000);
  }

  /**
   * Build a comprehensive prompt for the AI
   */
  _buildPrompt(questions, jobContext, userProfile) {
    const p = userProfile || {};

    // Build structured profile summary — only include non-empty, useful fields
    const profileSections = [];

    // 1. Personal Information
    const personalInfo = [];
    const fullName = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim();
    if (fullName) personalInfo.push(`Name: ${fullName}`);
    if (p.email) personalInfo.push(`Email: ${p.email}`);

    const fullPhone = p.countryCode && p.phone ? `${p.countryCode}${p.phone}` : p.phone;
    if (fullPhone) personalInfo.push(`Phone: ${fullPhone}`);

    const fullAltPhone = p.altCountryCode && p.alternatePhone ? `${p.altCountryCode}${p.alternatePhone}` : p.alternatePhone;
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

    const address = [p.address, p.city, p.state, p.pincode, p.country].filter(Boolean).join(', ');
    if (address) personalInfo.push(`Address: ${address}`);
    if (personalInfo.length > 0) {
      profileSections.push(`### Personal Information\n${personalInfo.join('\n')}`);
    }

    // 2. Education
    const education = [];
    if (p.degree) education.push(`Degree: ${p.degree}`);
    if (p.branch) education.push(`Major/Branch: ${p.branch}`);
    if (p.collegeName) education.push(`College: ${p.collegeName}`);
    if (p.university) education.push(`University: ${p.university}`);
    if (p.graduationYear) education.push(`Graduation Year: ${p.graduationYear}`);
    if (p.cgpa) education.push(`CGPA/GPA: ${p.cgpa}`);
    if (p.percentage) education.push(`Percentage: ${p.percentage}`);
    if (p.tenthPercentage) education.push(`10th Grade: ${p.tenthPercentage}%`);
    if (p.twelfthPercentage) education.push(`12th Grade: ${p.twelfthPercentage}%`);
    if (education.length > 0) {
      profileSections.push(`### Education\n${education.join('\n')}`);
    }

    // 3. Professional Experience
    const professional = [];
    if (p.experience) professional.push(`Total Experience: ${p.experience}`);
    if (p.currentCompany) professional.push(`Current Company: ${p.currentCompany}`);
    if (p.currentDesignation) professional.push(`Current Role: ${p.currentDesignation}`);
    if (p.skills) professional.push(`Skills: ${p.skills}`);
    if (p.currentCTC) professional.push(`Current Salary: ${p.currentCTC}`);
    if (p.expectedCTC) professional.push(`Expected Salary: ${p.expectedCTC}`);
    if (p.noticePeriod) professional.push(`Notice Period: ${p.noticePeriod}`);
    // Work experience entries
    if (Array.isArray(p.workExperiences) && p.workExperiences.length > 0) {
      p.workExperiences.forEach((we, i) => {
        const parts = [];
        if (we.company) parts.push(`Company: ${we.company}`);
        if (we.designationJoining) parts.push(`Role at Joining: ${we.designationJoining}`);
        if (we.designationLeaving) parts.push(`Role at Leaving: ${we.designationLeaving}`);
        if (we.workCity) parts.push(`City: ${we.workCity}`);
        if (we.workState) parts.push(`State: ${we.workState}`);
        if (we.workCountry) parts.push(`Country: ${we.workCountry}`);
        if (we.sector) parts.push(`Sector: ${we.sector}`);
        if (we.empType) parts.push(`Type: ${we.empType}`);
        if (we.startDate) parts.push(`Start: ${we.startDate}`);
        if (we.endDate) parts.push(`End: ${we.endDate}`);
        if (we.currentlyWorking === 'true') parts.push(`Currently Working: Yes`);
        if (we.compensation) parts.push(`Compensation: ${we.compensation}`);
        if (we.numMonths) parts.push(`Duration: ${we.numMonths} months`);
        if (parts.length > 0) {
          professional.push(`Work Experience #${i + 1}: ${parts.join(', ')}`);
        }
      });
    }
    if (professional.length > 0) {
      profileSections.push(`### Professional Background\n${professional.join('\n')}`);
    }

    // 3b. Availability
    const avail = [];
    if (p.earliestJoinDate) avail.push(`Earliest Join Date: ${p.earliestJoinDate}`);
    if (p.availableImmediately) avail.push(`Available Immediately: ${p.availableImmediately}`);
    if (p.willingToRelocate) avail.push(`Willing to Relocate: ${p.willingToRelocate}`);
    if (p.openToRemote) avail.push(`Open to Remote: ${p.openToRemote}`);
    if (p.openToHybrid) avail.push(`Open to Hybrid: ${p.openToHybrid}`);
    if (p.willingToTravel) avail.push(`Willing to Travel: ${p.willingToTravel}`);
    if (p.hasDriversLicense) avail.push(`Has Driver's License: ${p.hasDriversLicense}`);
    if (p.driversLicenseId) avail.push(`License ID: ${p.driversLicenseId}`);
    if (avail.length > 0) {
      profileSections.push(`### Availability & Preferences\n${avail.join('\n')}`);
    }

    // 4. Additional Information
    const additional = [];
    if (p.languages) additional.push(`Languages: ${p.languages}`);
    if (p.certifications) additional.push(`Certifications: ${p.certifications}`);
    if (p.achievements) additional.push(`Achievements: ${p.achievements}`);
    if (p.hobbies) additional.push(`Hobbies: ${p.hobbies}`);
    if (p.aboutMe) additional.push(`About: ${p.aboutMe}`);
    if (p.whyHire) additional.push(`Why Hire Me: ${p.whyHire}`);
    if (p.educationGaps) additional.push(`Education Gaps: ${p.educationGaps}`);
    if (additional.length > 0) {
      profileSections.push(`### Additional Details\n${additional.join('\n')}`);
    }

    // 5. Online Presence
    const links = [];
    if (p.linkedinUrl) links.push(`LinkedIn: ${p.linkedinUrl}`);
    if (p.githubUrl) links.push(`GitHub: ${p.githubUrl}`);
    if (p.portfolioUrl) links.push(`Portfolio: ${p.portfolioUrl}`);
    if (links.length > 0) {
      profileSections.push(`### Online Profiles\n${links.join('\n')}`);
    }

    // 6. Custom Q&A Data
    if (Array.isArray(p.customQA) && p.customQA.length > 0) {
      const qas = p.customQA.filter(q => q.question && q.answer).map(q => `Q: ${q.question} | A: ${q.answer}`);
      if (qas.length > 0) profileSections.push(`### Pre-Defined Custom Answers\nMATCH EXACTLY against these if asked:\n${qas.join('\n')}`);
    }

    const profileSummary = profileSections.join('\n\n');

    // Clean job description — remove HTML, scripts, Google Forms boilerplate
    const cleanDesc = this._cleanDescription(jobContext?.description);

    // Build job details section — only include non-empty fields
    const jobParts = [];
    const jobTitle = jobContext?.title || '';
    const jobCompany = jobContext?.company || '';
    const jobLocation = jobContext?.location || '';
    if (jobTitle) jobParts.push(`**Position:** ${jobTitle}`);
    if (jobCompany) jobParts.push(`**Company:** ${jobCompany}`);
    if (jobLocation) jobParts.push(`**Location:** ${jobLocation}`);
    if (cleanDesc) jobParts.push(`**Description:** ${cleanDesc}`);
    if (jobContext?.requirements) jobParts.push(`**Requirements:** ${jobContext.requirements.substring(0, 300)}`);

    // Build question list with enhanced formatting
    const questionList = questions.map((q, i) => {
      let qText = `${i + 1}. "${q.label}"`;
      qText += `\n   Type: ${q.type}`;
      if (q.required) qText += ' (REQUIRED)';
      if (q.options && q.options.length > 0) {
        qText += `\n   Available Options: ${q.options.join(' | ')}`;
      }
      return qText;
    }).join('\n\n');

    // Build the final prompt — compact and clean
    const skillsList = p.skills ? p.skills.split(',').map(s => s.trim()).filter(Boolean) : [];
    const skillsStr = skillsList.length > 0 ? skillsList.join(', ') : 'none listed';

    // Determine highest degree earned for the prompt
    const degreeNorm = (p.highestDegree || p.degree || '').toLowerCase();
    let educationLevel = 'Unknown';
    if (degreeNorm.includes('phd') || degreeNorm.includes('doctorate')) educationLevel = 'PhD';
    else if (degreeNorm.includes('master') || degreeNorm.includes('mba') || degreeNorm.includes('m.tech') || degreeNorm.includes('m.sc') || degreeNorm.includes('mca')) educationLevel = 'Masters';
    else if (degreeNorm.includes('bachelor') || degreeNorm.includes('b.tech') || degreeNorm.includes('b.e') || degreeNorm.includes('bca') || degreeNorm.includes('bba')) educationLevel = 'Bachelors';
    else if (degreeNorm.includes('diploma')) educationLevel = 'Diploma';
    else if (degreeNorm.includes('12th') || degreeNorm.includes('high school') || degreeNorm.includes('hsc') || degreeNorm.includes('intermediate')) educationLevel = 'High School';

    // Job preference instruction for unpaid/equity questions
    const jobPref = p.jobPreference || 'all';
    const unpaidPrefInstruction = jobPref === 'paid'
      ? `\n⚠️ IMPORTANT — JOB PREFERENCE: The candidate is set to "ONLY PAID JOBS". If ANY question asks about willingness to work in an unpaid position, no-equity role, volunteer work, or any form of zero/no compensation, you MUST answer "No". This is a hard rule — the candidate will NOT accept unpaid work.\n`
      : `\n⚠️ IMPORTANT — JOB PREFERENCE: The candidate is open to "ALL JOBS" including unpaid internships. If asked whether they are willing to work in an unpaid/no-equity role, answer "Yes".\n`;

    let prompt = `You are ${fullName || 'the candidate'} applying for a job.\nYou must answer the application questions acting AS the candidate in the FIRST PERSON ("I", "my", "me").\nDO NOT talk about the candidate in the third person (e.g., do not say "Aditya has...").\n${unpaidPrefInstruction}\n`;

    if (jobParts.length > 0) {
      prompt += `## 🎯 Job Details\n${jobParts.join('\n')}\n\n`;
    }

    prompt += `## 👤 Candidate Profile\n${profileSummary || '(Minimal profile data available)'}\n\n`;
    prompt += `## ❓ Questions to Answer\n${questionList}\n\n`;

    prompt += '## 📋 CRITICAL INSTRUCTIONS — CONCISE ANSWERS ONLY\n\n';
    prompt += '**Your Role:** You ARE the candidate. Answer using the candidate\'s actual profile data in FIRST PERSON ("I").\n\n';
    prompt += '**ANSWER FORMAT — MANDATORY:**\n';
    prompt += '- **Constraint/Error handling:** If a question label contains "(Constraint/Error: ...)", you MUST strictly follow it. If it says "Enter a whole number", return ONLY the number (e.g. "3" not "3 years").\n';
    prompt += '- **Number/Decimal fields:** Return ONLY the bare number. Example: "3" or "8.5" or "0". If asked for a decimal, DO NOT provide a whole number. If asked for a whole number, DO NOT provide a decimal. If a question asks skill rating and the field expects a decimal (0.0 to 10.0), return ONLY the number like "8.5"\n';
    prompt += '- **Skill rating:** If asked "How good are you at X" with a number field, return a number between 1-10\n';
    prompt += '- **Yes/No questions:** Return ONLY "Yes" or "No". Never say "Yes, I have".\n';
    prompt += '- **Options Provided:** If the question provides "Available Options", YOUR ANSWER MUST BE EXACTLY ONE OF THOSE OPTIONS. Do not hallucinate variants. If no exact match, choose the safest/closest available option.\n';
    prompt += '- **Date fields:** Return ONLY the date in YYYY-MM-DD format\n';
    prompt += '- **Text fields asking for a value** (salary, CTC, years, GPA, etc.): Return ONLY the value. Example: "5 LPA" or "Immediate"\n';
    prompt += '- **Text fields asking for names/URLs:** Return ONLY the value. Example: "John Doe" or "https://github.com/..."\n';
    prompt += '- **Expected compensation / CTC / Salary:** Provide ONLY the numeric value or the explicitly requested format (e.g. "12 LPA"). NEVER write a paragraph or cover letter for compensation questions.\n';
    prompt += '- **Cover letter / "Why hire you" / "Tell about yourself":** 2-3 concise sentences MAX, always in FIRST PERSON. ONLY write a paragraph if the question EXPLICITLY asks for a cover letter or why you are a good fit. Otherwise, NEVER write a paragraph.\n';
    prompt += '- **Languages:** If asked for languages knowing you, state "English" if none are specified in the profile.\n';
    prompt += '- **Generic greeting fields (like "Hello"):** Respond with a brief professional greeting\n\n';
    prompt += '⚠️ CRITICAL: Each question MUST receive a UNIQUE answer tailored to THAT specific question.\n';
    prompt += 'Never give the same answer to two different questions.\n';
    prompt += `- "What interests you about this company?" → Answer EXACTLY: "I am excited about ${jobCompany || 'this company'} because of the opportunity to work on innovative digital products and grow my skills in ${skillsStr}. With ${p.experience ? (String(p.experience).toLowerCase().includes('year') ? p.experience : p.experience + ' years') + ' of experience' : 'relevant experience'}, I believe I can contribute effectively to the team while learning from a dynamic environment."\n`;
    prompt += '- "What is your experience with X?" → Specific experience/years answer\n';
    prompt += '- "Describe a challenge you faced" → Specific story-based answer\n\n';
    prompt += '⚠️ DO NOT write full sentences for value-based questions (like "Language", "Phone", "Age"). If asked "Language", say "English". If asked "How many years...", say "1". NEVER hallucinate a cover letter paragraph into a short text field.\n\n';

    prompt += `## 🛑 SKILL QUESTIONS — VERY IMPORTANT\nThe candidate's EXACT listed skills are: **${skillsStr}**\n`;
    prompt += '- For ANY question asking "Do you know X?" or "Do you have experience with X?" or "Years of experience in X?":\n';
    prompt += '  - ONLY answer "Yes" (or a positive number) if X is EXPLICITLY in the skills list above\n';
    prompt += '  - If X is NOT in the list, answer "No" or "0"\n';
    prompt += '  - Do NOT guess or assume skills not listed. Example: if skills list doesn\'t include "PHP" or ".NET", answer "No" for those\n\n';

    prompt += `## 🎓 EDUCATION LEVEL\nThe candidate's current/highest education level is: **${educationLevel}** (Degree: ${p.degree || p.highestDegree || 'Not specified'})\n`;
    prompt += '- If asked "Do you have a Master\'s degree?" or "Are you a Masters graduate?" and education is NOT Masters or PhD → answer "No"\n';
    prompt += '- If asked about Bachelor\'s and education is only High School/Diploma → answer "No"\n';
    prompt += '- Match education questions STRICTLY to the actual degree earned\n\n';

    prompt += '## 📍 WORK EXPERIENCE LOCATION\n';
    prompt += '- For "Location" or "City" fields INSIDE a Work Experience section, give the CITY WHERE THE JOB WAS LOCATED (not the candidate\'s home address)\n';
    prompt += '- Do NOT put the candidate\'s personal home address in work experience location fields\n\n';

    prompt += '**NEVER:**\n';
    prompt += '- Say "Not applicable" or "N/A" — always provide a reasonable value\n';
    prompt += '- Leave answers blank\n';
    prompt += '- Write paragraphs for simple value questions\n';
    prompt += '- Mention missing profile data\n';
    prompt += '- Talk in the third person\n\n';

    prompt += '## 🎯 Response Format\n';
    prompt += 'Respond ONLY with a valid JSON array. Do NOT wrap it in markdown code fences.\n\n';
    prompt += '[\n  {"label": "exact question label", "answer": "concise value here"},\n  {"label": "exact question label", "answer": "concise value here"}\n]\n\n';
    prompt += 'Ensure every question gets an answer. Match the order and labels exactly.';

    return prompt;
  }

  /**
   * Parse AI response into structured answers
   */
  _parseResponse(responseText, questions) {
    let parsed = null;
    try {
      let cleaned = responseText.trim();

      // Remove markdown code fences
      cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      // Try to extract JSON array
      const jsonMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      }

      // Fix trailing commas if they exist
      cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

      parsed = JSON.parse(cleaned);

    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError.message);
      console.error('Raw response preview:', responseText.substring(0, 300));
    }

    if (Array.isArray(parsed)) {
      // Map parsed answers to questions safely
      return questions.map((q, i) => {
        const aiAnswer = parsed.find(a =>
          a.label === q.label ||
          (a.label && q.label && a.label.toLowerCase().includes(q.label.toLowerCase())) ||
          (q.label && a.label && q.label.toLowerCase().includes(a.label.toLowerCase()))
        ) || parsed[i];

        return {
          label: q.label,
          answer: String(aiAnswer?.answer || '').trim(),
          error: null
        };
      });
    }

    // Advanced Fallback Parser for broken JSON (Avoids line-by-line mismatch)
    console.log('⚠️ Using advanced regex fallback parser...');
    const extractedAnswers = [];
    const answerRegex = /"answer"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi;
    let match;
    while ((match = answerRegex.exec(responseText)) !== null) {
      extractedAnswers.push(match[1] || "");
    }

    return questions.map((q, i) => ({
      label: q.label,
      answer: extractedAnswers[i] !== undefined ? extractedAnswers[i] : '',
      error: extractedAnswers[i] !== undefined ? null : 'Fallback parser missing value'
    }));
  }

  /**
   * Generate fallback answer when AI is unavailable
   * Uses profile data to craft meaningful answers for common question types
   */
  _generateFallbackAnswer(question, userProfile, jobContext) {
    const p = userProfile || {};
    const jc = jobContext || {};
    const label = question.label.toLowerCase();
    const fullName = p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim();

    // Simple keyword matching for common structured fields
    if (label.includes('name') && !label.includes('company') && !label.includes('interest')) {
      return fullName || '';
    }
    if (label.includes('email')) return p.email || '';
    if (label.includes('phone') || label.includes('mobile')) return p.phone || '';
    if (label.includes('linkedin')) return p.linkedinUrl || '';
    if (label.includes('github')) return p.githubUrl || '';
    if (label.includes('portfolio')) return p.portfolioUrl || '';
    if (label.includes('experience') && !label.includes('why') && !label.includes('interest') && !label.includes('tell')) {
      return p.experience || '0';
    }
    if (label.includes('notice')) return p.noticePeriod || '30 days';
    if (label.includes('salary') || label.includes('ctc')) {
      if (label.includes('current')) return p.currentCTC || '';
      if (label.includes('expected')) return p.expectedCTC || '';
      return p.expectedCTC || p.currentCTC || '';
    }
    if (label.includes('city') || (label.includes('location') && !label.includes('interest'))) {
      return p.city || '';
    }
    if (label.includes('skill')) return p.skills || '';
    if (label.includes('cgpa') || label.includes('gpa')) return p.cgpa || '';
    if (label.includes('percentage') || label.includes('marks')) return p.percentage || '';
    if (label.includes('graduation') || label.includes('passing year')) return p.graduationYear || '';
    if (label.includes('college') || label.includes('university') || label.includes('institution')) {
      return p.collegeName || p.university || '';
    }
    if (label.includes('degree')) return p.degree || '';
    if (label.includes('branch') || label.includes('major') || label.includes('specialization')) {
      return p.branch || '';
    }

    // Open-ended / conversational questions — build a meaningful answer from profile
    const company = jc.company || jc.title || 'this company';
    const jobTitle = jc.title || 'this position';
    const skills = p.skills || 'full-stack development';
    const experienceText = p.experience || '';
    const experience = experienceText ? (experienceText.toLowerCase().includes('year') ? experienceText : `${experienceText} years`) + ' of experience' : 'relevant experience';
    const about = p.aboutMe || p.whyHire || '';

    // "What interests you..." / "Why do you want to work here..." / "Why this company..."
    if (label.includes('interest') || label.includes('why') || label.includes('motivat') ||
      label.includes('excit') || label.includes('passion') || label.includes('what draws') || label.includes('why this company')) {
      if (about) {
        return about.substring(0, 500);
      }
      return `I am excited about ${company} because of the opportunity to work on innovative digital products and grow my skills in ${skills}. ` +
        `With ${experience}, I believe I can contribute effectively to the team while learning from a dynamic environment.`;
    }

    // "Tell us about yourself" / "Describe yourself" / "About you"
    if (label.includes('tell') || label.includes('about you') || label.includes('describe') ||
      label.includes('introduce') || label.includes('background')) {
      if (about) return about.substring(0, 500);
      const degree = p.degree ? `${p.degree} in ${p.branch || 'Computer Science'}` : 'a technical background';
      return `I am ${fullName || 'a developer'} with ${experience} in ${skills}. ` +
        `I hold ${degree} from ${p.collegeName || 'a reputed institution'}. ` +
        `I am passionate about building impactful products and am eager to contribute to ${company}.`;
    }

    // "What are your strengths" / "What makes you a good fit"
    if (label.includes('strength') || label.includes('good fit') || label.includes('why hire') || label.includes('why should we')) {
      return p.whyHire || `My key strengths are ${skills}. I am a quick learner with ${experience}, and I am committed to delivering quality work. I thrive in collaborative environments and am passionate about ${jobTitle}.`;
    }

    // "What are your career goals" / "Where do you see yourself"
    if (label.includes('goal') || label.includes('career') || label.includes('future') || label.includes('see yourself')) {
      return `My goal is to grow as a ${jobTitle} and contribute to meaningful projects. ` +
        `I aim to deepen my expertise in ${skills} while taking on increasing responsibilities in a company like ${company}.`;
    }

    // "What do you know about us" / "Research about company"
    if (label.includes('know about') || label.includes('research') || label.includes('heard about us')) {
      return `I know that ${company} is focused on building innovative digital products and has a strong culture of growth and collaboration. ` +
        `I am excited about the work being done and believe my skills align well with your needs.`;
    }

    // For select/radio with options, pick first option
    if (question.options && question.options.length > 0) {
      return question.options[0];
    }

    // For yes/no questions, default to Yes
    if (question.type === 'radio' || question.type === 'checkbox') {
      return 'Yes';
    }

    // Skill check
    if (label.includes('experience with') || label.includes('proficient')) {
      return '0';
    }

    // Generic fallback - keep it concise and context-free to avoid wrong long answers
    return `N/A`;
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
        const model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const chat = model.startChat({
          generationConfig: { maxOutputTokens: 2048, temperature: 0.1 }
        });
        const result = await chat.sendMessage([{ text: prompt }]);
        const text = result.response.text().trim()
          .replace(/```json\s*/gi, '').replace(/```\s*/g, '');

        return JSON.parse(text);
      } catch (error) {
        const isRateLimit = error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED");
        const is503 = error?.status === 503 || error?.message?.includes("503");
        const isFetchError = error?.message?.includes("Error fetching");
        if ((isRateLimit || is503 || isFetchError) && attempt < this.clients.length - 1) {
          continue;
        }

        if (attempt === this.clients.length - 1) {
          // Return basic fallback
          return {
            title: 'Position',
            company: 'Company',
            description: rawText.substring(0, 200),
            requirements: '',
            location: ''
          };
        }
      }
    }

    return {
      title: 'Unknown',
      company: 'Unknown',
      description: rawText.substring(0, 200),
      requirements: '',
      location: ''
    };
  }
}

module.exports = { AIService };