const { logger } = require('../utils/logger');

class ValidationService {
    constructor() {
        this.rateLimits = new Map();
        this.MAX_REQUESTS_PER_HOUR = parseInt(process.env.MAX_REQUESTS_PER_USER_PER_HOUR) || 21;
        this.RATE_LIMIT_WINDOW = 3600000; // 1 hour in milliseconds
        this.concurrentRequests = new Map();
        this.MAX_CONCURRENT_GENERATIONS = parseInt(process.env.MAX_CONCURRENT_GENERATIONS) || 3;
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

        // Check concurrent requests
        const concurrentCount = this.concurrentRequests.get(userId) || 0;
        if (concurrentCount >= this.MAX_CONCURRENT_GENERATIONS) {
            throw new Error(`Too many concurrent requests. Please wait for your previous generations to complete.`);
        }

        // Increment request count
        userRateLimit.requests++;
        this.rateLimits.set(userId, userRateLimit);
        
        // Increment concurrent count
        this.concurrentRequests.set(userId, concurrentCount + 1);
        
        return true;
    }

    decrementConcurrentRequests(userId) {
        const concurrentCount = this.concurrentRequests.get(userId) || 0;
        if (concurrentCount > 0) {
            this.concurrentRequests.set(userId, concurrentCount - 1);
        }
    }

    validateUserInput(text) {
        if (!text || typeof text !== 'string') {
            throw new Error('Invalid input: Must provide a text description');
        }

        if (text.length < 3) {
            throw new Error('Input too short: Please provide a more detailed description (at least 3 characters)');
        }

        if (text.length > 1000) {
            throw new Error('Input too long: Must be under 1000 characters');
        }

        // Check for potentially harmful content
        const blockedTerms = [
            'hack', 'exploit', 'vulnerability', 'nude', 'naked', 'pornography', 
            'explicit', 'violence', 'gore', 'hate', 'harassment', 'terrorism'
        ];
        
        if (blockedTerms.some(term => text.toLowerCase().includes(term))) {
            throw new Error('Invalid input: Contains prohibited terms');
        }

        return true;
    }

    validateImageOptions(options = {}) {
        const validatedOptions = {};
        
        // Validate and normalize image format
        if (options.format) {
            const format = options.format.toLowerCase();
            if (!['jpeg', 'jpg', 'png'].includes(format)) {
                throw new Error('Invalid format: Must be jpeg/jpg or png');
            }
            validatedOptions.format = format;
        } else {
            validatedOptions.format = 'jpeg'; // Default format
        }
        
        // Validate image size (if implemented in the future)
        if (options.size) {
            const validSizes = ['small', 'medium', 'large'];
            if (!validSizes.includes(options.size)) {
                throw new Error(`Invalid size: Must be one of ${validSizes.join(', ')}`);
            }
            validatedOptions.size = options.size;
        } else {
            validatedOptions.size = 'medium'; // Default size
        }
        
        return validatedOptions;
    }
}

module.exports = new ValidationService();
