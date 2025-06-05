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
        
        // Enhanced prompt transformation configuration
        promptTransformation: {
            // Enhanced AI-powered transformation prompt for cultural sensitivity
            enhancedPrompt: `You are an expert in cultural photography and ethical AI image generation. Transform this prompt to be culturally sensitive and appropriate while preserving authentic human representation:

Original prompt: "{ORIGINAL_PROMPT}"

Guidelines:
1. PRESERVE cultural identity and authenticity - do not remove cultural context
2. ENHANCE with respectful, dignified language
3. ADD photographic quality descriptors (natural lighting, authentic setting, etc.)
4. MAINTAIN the human subject if appropriate - focus on dignity and respect
5. For children: emphasize natural, wholesome family contexts
6. Use terms like "authentic cultural portrait," "dignified representation," "natural family moment"
7. Avoid sanitizing cultural elements - embrace diversity respectfully

Transform to be more culturally appropriate and photographically excellent while keeping the core human story intact.

Return only the enhanced prompt, no explanations.`,

            // Original transformation prompt for truly problematic content
            prompt: `Transform this image generation prompt to avoid content policy violations while preserving cultural authenticity:

Original prompt: "{ORIGINAL_PROMPT}"

Guidelines:
1. If content is truly inappropriate (sexual, exploitative), create a respectful alternative
2. For normal cultural or family content, enhance with dignity and respect
3. Preserve human subjects when appropriate - focus on authentic representation
4. Use artistic, documentary, or portrait photography terms
5. Emphasize cultural sensitivity and human dignity
6. Add quality enhancers: natural lighting, authentic setting, respectful portrayal

Return only the transformed prompt, no explanations.`,
            
            // Generation configuration for transformation
            config: {
                temperature: 0.4,
                topK: 20,
                topP: 0.8,
                maxOutputTokens: 200
            }
        },
        
        // API error detection strings
        apiErrorStrings: {
            contentPolicy: [
                'content policy', 
                'safety', 
                'blocked', 
                '58061214',
                'responsible ai'
            ],
            quota: [
                'quota',
                'rate limit',
                'limit exceeded'
            ]
        },
        
        // Updated content detection patterns - more permissive
        contentDetection: {
            // Only flag truly problematic combinations
            highRiskPatterns: [
                /\b(?:naked|nude|undressed|sexual|inappropriate|exploitation)\b.*\b(?:child|children|kid|kids|minor)\b/i,
                /\b(?:child|children|kid|kids|minor)\b.*\b(?:naked|nude|undressed|sexual|inappropriate|exploitation)\b/i,
            ],
            
            // Cultural enhancement indicators
            culturalPatterns: [
                /\b(?:african|asian|hispanic|latino|native|indigenous|traditional|cultural|ethnic)\b/i,
                /\b(?:family|community|child|children|portrait|traditional)\b/i
            ],
            
            // Quality enhancement patterns
            qualityEnhancers: [
                'high quality photograph',
                'professional photography', 
                'natural lighting',
                'authentic cultural representation',
                'dignified portrayal',
                'respectful documentation',
                'photojournalistic style',
                'human warmth and connection',
                'meaningful cultural moment',
                'genuine expression',
                'cultural authenticity',
                'family bonds',
                'traditional setting',
                'natural environment'
            ],
            
            // Minimal replacement patterns - only for truly inappropriate content
            safetyReplacements: [
                { pattern: /\b(?:naked|nude|undressed)\b/gi, replacement: 'appropriately dressed' },
                { pattern: /\b(?:sexual|inappropriate)\b/gi, replacement: 'appropriate' },
                { pattern: /\b(?:exploitation|exploitative)\b/gi, replacement: 'respectful representation' }
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
