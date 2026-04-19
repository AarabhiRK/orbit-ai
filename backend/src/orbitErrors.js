/** Missing GEMINI_API_KEY (orbit routes require Gemini for narrative layer). */
export class GeminiConfigurationError extends Error {
  constructor(message = "GEMINI_API_KEY is not set. Add it to backend/.env for ORBIT narrative.") {
    super(message)
    this.name = "GeminiConfigurationError"
    this.code = "GEMINI_CONFIG"
  }
}

/** Gemini call succeeded but response was unusable, or API/timeout error. */
export class GeminiNarrativeError extends Error {
  constructor(message) {
    super(message)
    this.name = "GeminiNarrativeError"
    this.code = "GEMINI_NARRATIVE"
  }
}
