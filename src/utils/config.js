const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const config = {
    google: {
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        region: process.env.GOOGLE_CLOUD_REGION,
        credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    },
    app: {
        port: process.env.PORT || 3000,
        environment: process.env.NODE_ENV || 'development',
        logLevel: process.env.LOG_LEVEL || 'info',
    },
    rateLimit: {
        maxRequestsPerHour: parseInt(process.env.MAX_REQUESTS_PER_USER_PER_HOUR) || 21,
        maxConcurrentGenerations: parseInt(process.env.MAX_CONCURRENT_GENERATIONS) || 3,
    },
};

// Validate required configuration
const validateConfig = () => {
    const required = [
        'google.projectId',
        'google.region',
        'google.credentials',
    ];

    const missing = required.filter(key => {
        const value = key.split('.').reduce((obj, k) => obj && obj[k], config);
        return !value;
    });

    if (missing.length > 0) {
        throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
};

validateConfig();

module.exports = config;
