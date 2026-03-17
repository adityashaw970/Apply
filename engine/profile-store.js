const Store = require('electron-store');

class ProfileStore {
  constructor(store) {
    this.store = store || new Store();
  }

  getDefaultProfile() {
    return {
      // Personal Info
      firstName: '',
      lastName: '',
      fullName: '',
      email: '',
      countryCode: '+91',
      phone: '',
      altCountryCode: '+91',
      alternatePhone: '',
      dateOfBirth: '',
      age: '',
      gender: '',

      // Identity Documents
      aadhaarNo: '',
      panNo: '',
      voterId: '',

      // Bank Details
      bankAccountNo: '',
      ifscCode: '',
      bankName: '',

      // Address
      address: '',
      city: '',
      state: '',
      country: '',
      pincode: '',

      // Education
      collegeName: '',
      university: '',
      degree: '',
      branch: '',
      graduationYear: '',
      cgpa: '',
      percentage: '',
      tenthPercentage: '',
      twelfthPercentage: '',
      educationGaps: '',
      highestDegree: '',

      // Work Experience (multi-entry array stored separately)
      workExperiences: [],

      // Professional
      skills: '',
      experience: '',
      currentCompany: '',
      currentDesignation: '',
      expectedCTC: '',
      currentCTC: '',
      noticePeriod: '',

      // Availability & Joining
      earliestJoinDate: '',
      availableImmediately: '',
      fullTimeImmediately: '',
      needSpecificStartDate: '',
      willingToRelocate: '',
      openToRemote: '',
      openToHybrid: '',
      willingToTravel: '',

      // Driver's License
      hasDriversLicense: '',
      driversLicenseId: '',

      // Links
      linkedinUrl: '',
      githubUrl: '',
      portfolioUrl: '',
      resumeUrl: '',

      // Files
      resumePath: '',
      coverLetterPath: '',
      photoPath: '',

      // Additional
      languages: '',
      certifications: '',
      achievements: '',
      hobbies: '',
      aboutMe: '',
      whyHire: '',

      // Custom Q&A
      customQA: []
    };
  }

  getProfile() {
    const defaults = this.getDefaultProfile();
    const saved = this.store.get('userProfile', {});
    return { ...defaults, ...saved };
  }

  saveProfile(data) {
    this.store.set('userProfile', data);
  }

  /**
   * Get a flat map of all common field name variations → profile values
   * Used for fuzzy matching form fields
   */
  getFieldMap() {
    const p = this.getProfile();
    const fullPhone = p.countryCode && p.phone ? `${p.countryCode}${p.phone}` : p.phone;
    const fullAltPhone = p.altCountryCode && p.alternatePhone ? `${p.altCountryCode}${p.alternatePhone}` : p.alternatePhone;

    return {
      // Name variations
      'name': p.fullName || `${p.firstName} ${p.lastName}`.trim(),
      'full name': p.fullName || `${p.firstName} ${p.lastName}`.trim(),
      'fullname': p.fullName || `${p.firstName} ${p.lastName}`.trim(),
      'first name': p.firstName,
      'firstname': p.firstName,
      'first_name': p.firstName,
      'fname': p.firstName,
      'last name': p.lastName,
      'lastname': p.lastName,
      'last_name': p.lastName,
      'lname': p.lastName,
      'surname': p.lastName,

      // Contact
      'email': p.email,
      'email address': p.email,
      'e-mail': p.email,
      'email_address': p.email,
      'mail': p.email,
      'phone': fullPhone,
      'phone number': fullPhone,
      'phonenumber': fullPhone,
      'phone_number': fullPhone,
      'mobile': fullPhone,
      'mobile number': fullPhone,
      'alternate phone': fullAltPhone,
      'alternate number': fullAltPhone,
      'contact': fullPhone,
      'contact number': fullPhone,
      'tel': fullPhone,
      'telephone': fullPhone,
      'whatsapp': fullPhone,
      'alternate phone': p.alternatePhone,

      // DOB & Personal
      'date of birth': p.dateOfBirth,
      'dob': p.dateOfBirth,
      'birth date': p.dateOfBirth,
      'birthday': p.dateOfBirth,
      'age': p.age,
      'gender': p.gender,
      'sex': p.gender,

      // Identity
      'aadhaar': p.aadhaarNo,
      'aadhar': p.aadhaarNo,
      'aadhaar number': p.aadhaarNo,
      'pan': p.panNo,
      'pan number': p.panNo,
      'pan card': p.panNo,
      'voter id': p.voterId,
      'voter card': p.voterId,

      // Bank
      'account number': p.bankAccountNo,
      'bank account': p.bankAccountNo,
      'ifsc': p.ifscCode,
      'ifsc code': p.ifscCode,
      'bank name': p.bankName,

      // Address
      'address': p.address,
      'street': p.address,
      'city': p.city,
      'town': p.city,
      'state': p.state,
      'province': p.state,
      'country': p.country,
      'nation': p.country,
      'pincode': p.pincode,
      'zip': p.pincode,
      'zip code': p.pincode,
      'zipcode': p.pincode,
      'postal code': p.pincode,
      'postal': p.pincode,

      // Education
      'college': p.collegeName,
      'college name': p.collegeName,
      'institution': p.collegeName,
      'school': p.collegeName,
      'university': p.university || p.collegeName,
      'degree': p.degree,
      'qualification': p.degree,
      'highest degree': p.highestDegree || p.degree,
      'branch': p.branch,
      'major': p.branch,
      'specialization': p.branch,
      'stream': p.branch,
      'department': p.branch,
      'graduation year': p.graduationYear,
      'year of graduation': p.graduationYear,
      'passing year': p.graduationYear,
      'batch': p.graduationYear,
      'cgpa': p.cgpa,
      'gpa': p.cgpa,
      'cpi': p.cgpa,
      'percentage': p.percentage,
      'marks': p.percentage,
      '10th': p.tenthPercentage,
      '10th percentage': p.tenthPercentage,
      'ssc': p.tenthPercentage,
      'tenth': p.tenthPercentage,
      '12th': p.twelfthPercentage,
      '12th percentage': p.twelfthPercentage,
      'hsc': p.twelfthPercentage,
      'twelfth': p.twelfthPercentage,
      'intermediate': p.twelfthPercentage,
      'education gap': p.educationGaps,
      'education gaps': p.educationGaps,

      // Professional
      'skills': p.skills,
      'key skills': p.skills,
      'technical skills': p.skills,
      'experience': p.experience,
      'work experience': p.experience,
      'total experience': p.experience,
      'years of experience': p.experience,
      'current company': p.currentCompany,
      'company': p.currentCompany,
      'organization': p.currentCompany,
      'current designation': p.currentDesignation,
      'designation': p.currentDesignation,
      'job title': p.currentDesignation,
      'position': p.currentDesignation,
      'role': p.currentDesignation,
      'expected ctc': p.expectedCTC,
      'expected salary': p.expectedCTC,
      'expected package': p.expectedCTC,
      'compensation': p.expectedCTC,
      'expected compensation': p.expectedCTC,
      'expected comp': p.expectedCTC,
      'current ctc': p.currentCTC,
      'current salary': p.currentCTC,
      'notice period': p.noticePeriod,

      // Availability
      'earliest joining date': p.earliestJoinDate,
      'earliest start date': p.earliestJoinDate,
      'join date': p.earliestJoinDate,
      'available immediately': p.availableImmediately,
      'available to start immediately': p.availableImmediately,
      'full time immediately': p.fullTimeImmediately,
      'willing to relocate': p.willingToRelocate,
      'open to remote': p.openToRemote,
      'open to hybrid': p.openToHybrid,
      'willing to travel': p.willingToTravel,
      'have driver license': p.hasDriversLicense,
      'drivers license': p.hasDriversLicense,
      'driving license': p.hasDriversLicense,

      // Links
      'linkedin': p.linkedinUrl,
      'linkedin url': p.linkedinUrl,
      'linkedin profile': p.linkedinUrl,
      'github': p.githubUrl,
      'github url': p.githubUrl,
      'github profile': p.githubUrl,
      'portfolio': p.portfolioUrl,
      'portfolio url': p.portfolioUrl,
      'website': p.portfolioUrl,
      'personal website': p.portfolioUrl,
      'resume link': p.resumeUrl,
      'resume url': p.resumeUrl,
      'cv link': p.resumeUrl,

      // Additional
      'languages': p.languages,
      'language': p.languages,
      'certifications': p.certifications,
      'certificates': p.certifications,
      'achievements': p.achievements,
      'awards': p.achievements,
      'hobbies': p.hobbies,
      'interests': p.hobbies,
      'about': p.aboutMe,
      'about me': p.aboutMe,
      'about yourself': p.aboutMe,
      'tell us about yourself': p.aboutMe,
      'summary': p.aboutMe,
      'objective': p.aboutMe,
      'cover letter': p.aboutMe,
      'why should we hire you': p.whyHire,
      'why hire': p.whyHire
    };
  }
}

module.exports = { ProfileStore };

