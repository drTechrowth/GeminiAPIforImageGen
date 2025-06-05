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
    gemini: {
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        location: process.env.GOOGLE_CLOUD_REGION || 'us-central1',
        
        // Image generation models in order of preference
        imageModels: [
            'imagegeneration@006',
            'imagegeneration@005',
            'imagegeneration@002'
        ],
        
        // Text model for prompt transformation
        textModel: 'gemini-2.0-flash-001',
        
        // Prompt transformation configuration
        promptTransformation: {
            // AI-powered transformation prompt
            prompt: `Transform this image generation prompt to avoid content policy violations while preserving the core visual intent:

Original prompt: "{ORIGINAL_PROMPT}"

Guidelines:
1. If the prompt mentions children, minors, or specific ages - transform to focus on objects, products, or abstract concepts instead
2. Replace human subjects with inanimate objects, art styles, or conceptual representations
3. If it's about food/drinks, focus on the product itself, not consumption by people
4. Maintain the essence (colors, mood, style) but remove human elements
5. Make it artistic and abstract rather than realistic
6. Use terms like "artistic representation," "conceptual design," "product photography," "still life"

Return only the transformed prompt, no explanations or quotes.`,
            
            // Generation configuration for transformation
            config: {
                temperature: 0.3,
                topK: 10,
                topP: 0.5,
                maxOutputTokens: 150
            }
        },
        
        // API error detection strings
        apiErrorStrings: {
            contentPolicy: [
                'content policy', 
                'safety', 
                'blocked', 
                '58061214'
            ],
            quota: [
                'quota',
                'rate limit',
                'limit exceeded'
            ]
        },
        
        // Content detection patterns
        contentDetection: {
            agePatterns: [
                /\b(?:child|children|kid|kids|boy|girl|baby|babies|infant|toddler|teen|teenager)\b/i,
                /\b(?:\d+[\s-]?(?:year|yr)[\s-]?old|years?\s+old)\b/i,
                /\b(?:minor|juvenile|youth|young|little|small)\s+(?:person|people|human|individual)\b/i,
                /\b(?:school|student|pupil|kindergarten|preschool)\b/i
            ],
            
            riskPatterns: [
                /\b(?:model|modeling|pose|posing|photoshoot)\b/i,
                /\b(?:cute|adorable|sweet|innocent)\s+(?:child|kid|boy|girl)\b/i,
                /\b(?:drinking|eating|consuming)\b.*\b(?:milk|formula|bottle)\b/i
            ],
            
            // Replacement patterns for rule-based transformation
            replacements: [
                // Age patterns
                { pattern: /\b\d+[\s-]?(?:year|yr)[\s-]?old\b/gi, replacement: '' },
                { pattern: /\byears?\s+old\b/gi, replacement: '' },
                
                // People to objects
                { pattern: /\b(?:child|children|kid|kids|boy|girl|baby|babies|infant|toddler)\b/gi, replacement: 'product' },
                { pattern: /\b(?:person|people|human|individual|model)\b/gi, replacement: 'item' },
                
                // Actions to states
                { pattern: /\b(?:drinking|eating|consuming)\b/gi, replacement: 'featuring' },
                { pattern: /\b(?:holding|grasping|clutching)\b/gi, replacement: 'displaying' },
                
                // Contexts to artistic styles
                { pattern: /\bphotoshoot\b/gi, replacement: 'product photography' },
                { pattern: /\bmodeling\b/gi, replacement: 'artistic arrangement' },
                { pattern: /\bpose\b/gi, replacement: 'composition' }
            ]
        }
    }
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
