const { VertexAI } = require('@google-cloud/vertexai');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const config = require('../utils/config');

class GeminiService {
    constructor() {
        try {
            if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
                throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable');
            }

            this.validateAndParseCredentials();
            this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || this.credentials.project_id;
            this.location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';

            this.setupCredentialsFile();

            this.auth = new GoogleAuth({
                keyFile: this.credentialsPath,
                scopes: ['https://www.googleapis.com/auth/cloud-platform']
            });

            this.vertexai = new VertexAI({
                project: this.projectId,
                location: this.location,
                googleAuthOptions: {
                    keyFile: this.credentialsPath,
                    scopes: ['https://www.googleapis.com/auth/cloud-platform']
                }
            });

            // Available image generation models in order of preference
            this.imageModels = [
                'imagegeneration@006',
                'imagegeneration@005',
                'imagegeneration@002'
            ];

            logger.info('Successfully initialized Vertex AI client');
        } catch (error) {
            logger.error(`Error initializing Vertex AI: ${error.message}`);
            throw new Error('Failed to initialize image generation service');
        }
    }

    validateAndParseCredentials() {
        try {
            const credString = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
            logger.info(`Credential string length: ${credString.length}`);
            
            this.credentials = JSON.parse(credString);
            
            const privateKey = this.credentials.private_key;
            
            const requiredFields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id', 'auth_uri', 'token_uri'];
            const missingFields = requiredFields.filter(field => !this.credentials[field]);
            
            if (missingFields.length > 0) {
                throw new Error(`Missing required credential fields: ${missingFields.join(', ')}`);
            }
            
            if (this.credentials.type !== 'service_account') {
                throw new Error(`Invalid credential type: ${this.credentials.type}. Expected: service_account`);
            }
            
            if (!this.credentials.private_key.includes('-----BEGIN PRIVATE KEY-----')) {
                throw new Error('Invalid private key format. Missing PEM headers.');
            }
            
            // Fix private key newlines
            if (privateKey.includes('\\n') && !privateKey.includes('\n')) {
                logger.info('Converting escaped newlines to actual newlines in private key');
                this.credentials.private_key = privateKey.replace(/\\n/g, '\n');
            } else if (!privateKey.includes('\n')) {
                logger.warn('Private key appears to be missing newlines. Attempting to fix...');
                this.credentials.private_key = privateKey
                    .replace(/-----BEGIN PRIVATE KEY-----/g, '-----BEGIN PRIVATE KEY-----\n')
                    .replace(/-----END PRIVATE KEY-----/g, '\n-----END PRIVATE KEY-----')
                    .replace(/(.{64})/g, '$1\n')
                    .replace(/\n\n/g, '\n');
            }
            
            logger.info(`Successfully validated credentials for: ${this.credentials.client_email}`);
            
        } catch (parseError) {
            logger.error('Failed to parse credentials JSON:', parseError.message);
            throw new Error(`Invalid credential JSON format: ${parseError.message}`);
        }
    }

    setupCredentialsFile() {
        try {
            const tmpDir = '/tmp';
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }

            this.credentialsPath = path.join(tmpDir, `gcp-credentials-${Date.now()}.json`);
            const credentialsContent = JSON.stringify(this.credentials, null, 2);
            fs.writeFileSync(this.credentialsPath, credentialsContent, { mode: 0o600 });
            
            const writtenContent = fs.readFileSync(this.credentialsPath, 'utf8');
            const parsedWritten = JSON.parse(writtenContent);
            
            if (parsedWritten.client_email !== this.credentials.client_email) {
                throw new Error('Credential file verification failed');
            }
            
            process.env.GOOGLE_APPLICATION_CREDENTIALS = this.credentialsPath;
            
            logger.info(`Credentials file created and verified at: ${this.credentialsPath}`);
        } catch (error) {
            logger.error(`Error setting up credentials file: ${error.message}`);
            throw error;
        }
    }

    async testAuth() {
        try {
            logger.info('Testing Google Cloud authentication...');
            
            const client = await this.auth.getClient();
            const accessToken = await client.getAccessToken();
            
            if (accessToken && accessToken.token) {
                logger.info('Authentication test successful');
                return true;
            } else {
                throw new Error('No access token received');
            }
        } catch (error) {
            logger.error('Authentication test failed:', error.message);
            
            if (error.message.includes('Invalid JWT Signature')) {
                throw new Error('JWT signature validation failed. Please regenerate your service account key.');
            } else if (error.message.includes('invalid_grant')) {
                throw new Error('Invalid grant error. Please check your service account permissions.');
            } else if (error.message.includes('Forbidden')) {
                throw new Error('Access denied. Ensure your service account has required IAM roles.');
            }
            
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }

    // Enhanced prompt sanitization with more comprehensive filtering
    sanitizePrompt(prompt) {
        let sanitized = prompt.trim();

        // Remove problematic words that often trigger content policies
        const problematicTerms = {
            // People-related terms that can be problematic
            'person': 'figure',
            'people': 'figures',
            'human': 'character',
            'humans': 'characters',
            'man': 'male figure',
            'woman': 'female figure',
            'men': 'male figures',
            'women': 'female figures',
            'boy': 'young male character',
            'girl': 'young female character',
            'child': 'young character',
            'children': 'young characters',
            'baby': 'infant character',
            
            // Appearance-related terms
            'beautiful': 'elegant',
            'sexy': 'stylish',
            'attractive': 'appealing',
            'gorgeous': 'lovely',
            'handsome': 'distinguished',
            
            // Body-related terms
            'body': 'form',
            'face': 'features',
            'skin': 'surface',
            
            // Brand names
            'nike': 'athletic brand',
            'adidas': 'sports brand',
            'apple': 'tech company',
            'google': 'search engine',
            'facebook': 'social media',
            'instagram': 'photo app',
            'twitter': 'social platform',
            'coca cola': 'cola drink',
            'pepsi': 'cola beverage',
            'mcdonalds': 'fast food',
            'starbucks': 'coffee shop',
            
            // Potentially sensitive locations
            'school': 'educational building',
            'hospital': 'medical facility',
            'church': 'religious building',
            'mosque': 'religious building',
            'temple': 'religious building'
        };

        // Apply replacements with word boundaries
        for (const [term, replacement] of Object.entries(problematicTerms)) {
            const regex = new RegExp(`\\b${term}\\b`, 'gi');
            sanitized = sanitized.replace(regex, replacement);
        }

        // Remove multiple spaces and clean up
        sanitized = sanitized.replace(/\s+/g, ' ').trim();

        return sanitized;
    }

    // Enhanced prompt optimization with better content policy awareness
    async optimizePromptForPolicy(originalPrompt) {
        try {
            logger.info(`Optimizing prompt for content policy: ${originalPrompt}`);

            const textModel = this.vertexai.preview.getGenerativeModel({
                model: 'gemini-2.0-flash-001'
            });

            const optimizationPrompt = `
You are an expert at creating prompts for Google's image generation API that comply with their content policies.

Transform this prompt to avoid content policy violations while preserving the creative intent:

Rules:
1. Replace specific people/celebrities with generic descriptions
2. Use artistic and creative language instead of realistic human descriptions
3. Focus on objects, landscapes, art styles, and abstract concepts
4. Avoid brand names, logos, copyrighted characters
5. Use terms like "artistic rendering", "stylized", "illustration style"
6. Replace "photo" or "realistic" with "artwork", "painting", "digital art"
7. Avoid describing human features in detail
8. Make it sound more like an art commission than a photo request

Original: "${originalPrompt}"

Return only the optimized prompt, no explanations:`;

            const result = await textModel.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: optimizationPrompt }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    topK: 10,
                    topP: 0.5,
                    maxOutputTokens: 300
                }
            });

            const candidate = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (candidate) {
                const optimizedPrompt = candidate.replace(/^["']|["']$/g, '');
                logger.info(`AI optimized prompt: ${optimizedPrompt}`);
                return {
                    original: originalPrompt,
                    optimized: optimizedPrompt,
                    method: 'ai_policy_optimization'
                };
            } else {
                throw new Error('No optimization result');
            }

        } catch (error) {
            logger.error('AI optimization failed:', error.message);
            // Fallback to rule-based optimization
            return this.ruleBasedOptimization(originalPrompt);
        }
    }

    // Rule-based optimization as fallback
    ruleBasedOptimization(originalPrompt) {
        let optimized = this.sanitizePrompt(originalPrompt);

        // Add safe artistic modifiers
        const safeModifiers = [
            'digital artwork of',
            'artistic illustration of',
            'stylized rendering of',
            'creative visualization of',
            'artistic interpretation of'
        ];

        // Check if prompt already has artistic language
        const hasArtisticLanguage = /\b(art|artistic|illustration|painting|drawing|digital|stylized|rendered)\b/i.test(optimized);

        if (!hasArtisticLanguage) {
            const randomModifier = safeModifiers[Math.floor(Math.random() * safeModifiers.length)];
            optimized = `${randomModifier} ${optimized}`;
        }

        // Add style suffix to make it more artistic
        if (!optimized.includes('style') && !optimized.includes('art')) {
            optimized += ', digital art style';
        }

        return {
            original: originalPrompt,
            optimized: optimized,
            method: 'rule_based_safe'
        };
    }

    async validatePrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Prompt is required and must be a string');
        }

        if (prompt.length > 1000) {
            throw new Error('Prompt must be less than 1000 characters');
        }

        // More comprehensive harmful content check
        const harmfulPatterns = [
            // Explicit content
            /\b(explicit|nsfw|nude|naked|sexual|erotic|porn)\b/i,
            // Violence
            /\b(violence|blood|gore|kill|murder|death|weapon|gun|knife|bomb|explosion)\b/i,
            // Hate speech
            /\b(hate|racist|discrimination|nazi|terrorist)\b/i,
            // Drugs
            /\b(drugs|cocaine|heroin|meth|marijuana|weed|smoking|alcohol|drunk)\b/i,
            // Copyrighted characters
            /\b(mickey mouse|superman|batman|spiderman|pokemon|naruto|mario|sonic)\b/i,
            // Celebrities (add more as needed)
            /\b(elon musk|donald trump|taylor swift|leonardo dicaprio|angelina jolie)\b/i
        ];

        for (const pattern of harmfulPatterns) {
            if (pattern.test(prompt)) {
                logger.warn(`Prompt flagged by pattern: ${pattern.source}`);
                throw new Error('Prompt contains potentially inappropriate content');
            }
        }

        return true;
    }

    async generateImage(prompt, userId, options = {}) {
        try {
            logger.info(`Generating image for user ${userId} with prompt: ${prompt}`);
            
            await this.validatePrompt(prompt);

            // Enhanced strategy sequence with more policy-aware optimizations
            const strategies = [
                // Strategy 1: Try original with basic sanitization
                () => ({
                    original: prompt,
                    optimized: this.sanitizePrompt(prompt),
                    method: 'basic_sanitization'
                }),
                
                // Strategy 2: Rule-based safe optimization
                () => this.ruleBasedOptimization(prompt),
                
                // Strategy 3: AI-powered policy optimization
                () => this.optimizePromptForPolicy(prompt),
                
                // Strategy 4: Ultra-safe fallback
                () => ({
                    original: prompt,
                    optimized: `abstract artistic concept inspired by: ${this.sanitizePrompt(prompt).substring(0, 50)}, minimalist digital art`,
                    method: 'ultra_safe_fallback'
                })
            ];

            let lastError = null;

            for (let i = 0; i < strategies.length; i++) {
                try {
                    const promptResult = await strategies[i]();
                    const finalPrompt = promptResult.optimized;
                    
                    logger.info(`Trying strategy ${i + 1}: ${promptResult.method} - "${finalPrompt}"`);
                    
                    // Try each model in order
                    for (const model of this.imageModels) {
                        try {
                            logger.info(`Attempting with model: ${model}`);
                            const result = await this.generateWithModel(finalPrompt, model, options);
                            
                            if (result && result.base64) {
                                logger.info(`Success with model ${model} and strategy ${promptResult.method}`);
                                return {
                                    ...result,
                                    promptUsed: finalPrompt,
                                    originalPrompt: prompt,
                                    promptWasOptimized: promptResult.original !== promptResult.optimized,
                                    optimizationMethod: promptResult.method,
                                    modelUsed: model,
                                    strategyUsed: i + 1
                                };
                            }
                        } catch (modelError) {
                            logger.warn(`Model ${model} failed: ${modelError.message}`);
                            lastError = modelError;
                            
                            // If it's a content policy error, try next strategy immediately
                            if (modelError.message.includes('content policy') || 
                                modelError.message.includes('safety') ||
                                modelError.message.includes('blocked') ||
                                modelError.message.includes('violate our policies')) {
                                logger.info('Content policy violation detected, trying next strategy');
                                break; // Break model loop, try next strategy
                            }
                        }
                    }
                } catch (strategyError) {
                    logger.warn(`Strategy ${i + 1} failed: ${strategyError.message}`);
                    lastError = strategyError;
                }
            }

            // If all strategies failed, provide helpful error message
            throw new Error('Unable to generate image that complies with content policies. Try using more abstract, artistic language focused on objects, landscapes, or art styles rather than realistic human descriptions.');

        } catch (error) {
            logger.error(`Error generating image: ${error.message}`);
            
            if (error.message && error.message.includes('quota')) {
                throw new Error('Rate limit exceeded. Please try again later.');
            } else if (error.message && (error.message.includes('content policy') || 
                      error.message.includes('safety') || 
                      error.message.includes('violate our policies'))) {
                throw new Error('Content policy violation. Try describing your image using artistic terms like "digital artwork", "illustration", or "artistic rendering" instead of realistic descriptions.');
            }
            
            throw error;
        }
    }

    // Enhanced model generation with better parameter tuning
    async generateWithModel(prompt, modelName, options = {}) {
        try {
            await this.testAuth();
            const accessToken = await this.getAccessToken();
            const fetch = require('node-fetch');
            
            const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${modelName}:predict`;
            
            // Enhanced request body with better safety configuration
            const requestBody = {
                instances: [
                    {
                        prompt: prompt
                    }
                ],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: options.aspectRatio || "1:1",
                    // Most permissive safety settings
                    safetyFilterLevel: "block_few", // Most permissive option
                    personGeneration: "allow_adult", // Allow adult person generation
                    // Add guidance scale for better prompt adherence
                    guidanceScale: 7, // Lower values = more creative freedom
                    // Seed for reproducibility if needed
                    ...(options.seed && { seed: options.seed })
                }
            };

            logger.info(`Making request to ${modelName}:`, url);
            logger.info(`Request parameters:`, JSON.stringify(requestBody.parameters, null, 2));

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            const responseText = await response.text();
            logger.info(`${modelName} response status: ${response.status}`);

            if (!response.ok) {
                logger.error(`${modelName} error response:`, responseText);
                
                if (response.status === 400) {
                    const errorData = JSON.parse(responseText);
                    if (errorData.error && errorData.error.message) {
                        if (errorData.error.message.includes('violate our policies') ||
                            errorData.error.message.includes('content policy') ||
                            errorData.error.message.includes('safety') ||
                            errorData.error.message.includes('blocked')) {
                            throw new Error('Content policy violation');
                        }
                    }
                }
                
                throw new Error(`${modelName} API error: ${response.status} - ${responseText}`);
            }

            let result;
            try {
                result = JSON.parse(responseText);
            } catch (parseError) {
                throw new Error('Invalid response format from image generation API');
            }
            
            if (result.predictions && result.predictions[0] && result.predictions[0].bytesBase64Encoded) {
                return {
                    base64: result.predictions[0].bytesBase64Encoded,
                    mimeType: 'image/png'
                };
            }

            // Check for empty response (usually content policy issue)
            if (result.predictions && result.predictions.length === 0) {
                throw new Error('Content policy violation - empty response');
            }

            throw new Error('No image data in response');

        } catch (error) {
            logger.error(`${modelName} generation failed:`, error.message);
            throw error;
        }
    }

    async getAccessToken() {
        try {
            const client = await this.auth.getClient();
            const accessTokenResponse = await client.getAccessToken();
            return accessTokenResponse.token;
        } catch (error) {
            logger.error('Failed to get access token:', error.message);
            throw error;
        }
    }

    cleanup() {
        try {
            if (this.credentialsPath && fs.existsSync(this.credentialsPath)) {
                fs.unlinkSync(this.credentialsPath);
                logger.info('Cleaned up temporary credentials file');
            }
        } catch (error) {
            logger.warn('Failed to cleanup credentials file:', error.message);
        }
    }
}

// Create singleton instance
const geminiService = new GeminiService();

// Cleanup on process exit
process.on('exit', () => {
    geminiService.cleanup();
});

process.on('SIGINT', () => {
    geminiService.cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    geminiService.cleanup();
    process.exit(0);
});

module.exports = geminiService;
