const { logger } = require('../utils/logger');

class ValidationService {
    constructor() {
        this.rateLimits = new Map();
        this.MAX_REQUESTS_PER_HOUR = parseInt(process.env.MAX_REQUESTS_PER_USER_PER_HOUR) || 21;
        this.RATE_LIMIT_WINDOW = 3600000; // 1 hour in milliseconds
    }

    validateRateLimit(userId) {
        const now = Date.now();
        const userRateLimit = this.rateLimits.get(userId) || {
            requests: 0,
            windowStart: now
        };

        // Reset window if it's expired
        if (now - userRateLimit.windowStart > this.RATE_LIMIT_WINDOW) {
            userRateLimit.requests = 0;
            userRateLimit.windowStart = now;
        }

        // Check if user has exceeded rate limit
        if (userRateLimit.requests >= this.MAX_REQUESTS_PER_HOUR) {
            const minutesUntilReset = Math.ceil((this.RATE_LIMIT_WINDOW - (now - userRateLimit.windowStart)) / 60000);
            throw new Error(`Rate limit exceeded. Please try again in ${minutesUntilReset} minutes.`);
        }

        // Increment request count
        userRateLimit.requests++;
        this.rateLimits.set(userId, userRateLimit);
        return true;
    }

    validateUserInput(text) {
        if (!text || typeof text !== 'string') {
            throw new Error('Invalid input: Must provide a text description');
        }

        if (text.length < 3) {
            throw new Error('Input too short: Please provide a more detailed description');
        }

        if (text.length > 1000) {
            throw new Error('Input too long: Must be under 1000 characters');
        }

        // Check for potentially harmful content
        const blockedTerms = ['hack', 'exploit', 'vulnerability'];
        if (blockedTerms.some(term => text.toLowerCase().includes(term))) {
            throw new Error('Invalid input: Contains prohibited terms');
        }

        return true;
    }
}

module.exports = new ValidationService();
