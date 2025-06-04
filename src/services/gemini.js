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

    // IMPROVED: Lighter prompt optimization that's less likely to trigger filters
    async optimizePromptMinimally(originalPrompt) {
        try {
            logger.info(`Minimally optimizing prompt: ${originalPrompt}`);

            const textModel = this.vertexai.preview.getGenerativeModel({
                model: 'gemini-2.0-flash-001'
            });

            const optimizationPrompt = `
You are a prompt optimizer for image generation. Make minimal changes to improve this prompt while avoiding content policy issues:

Rules:
1. Keep the original meaning and intent
2. Only replace obvious brand names with generic terms if present
3. Make language more descriptive but neutral
4. Don't add commercial or advertising language unless already present
5. Keep it natural and simple

Original prompt: "${originalPrompt}"

Return only the improved prompt, no quotes or explanations.
`;

            const result = await textModel.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: optimizationPrompt }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    topK: 5,
                    topP: 0.3,
                    maxOutputTokens: 200
                }
            });

            const candidate = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (candidate) {
                const optimizedPrompt = candidate.replace(/^["']|["']$/g, '');
                logger.info(`Minimally optimized prompt: ${optimizedPrompt}`);
                return {
                    original: originalPrompt,
                    optimized: optimizedPrompt,
                    method: 'minimal_ai'
                };
            } else {
                return {
                    original: originalPrompt,
                    optimized: originalPrompt,
                    method: 'no_change'
                };
            }

        } catch (error) {
            logger.error('Minimal AI optimization failed:', error.message);
            return {
                original: originalPrompt,
                optimized: originalPrompt,
                method: 'error_fallback'
            };
        }
    }

    // SIMPLIFIED: Much lighter rule-based optimization
    lightweightPromptOptimization(originalPrompt) {
        try {
            let processedPrompt = originalPrompt.trim();

            // Only replace obvious brand names
            const brandReplacements = {
                'coca cola': 'cola drink',
                'pepsi': 'cola beverage',
                'nike': 'athletic wear',
                'adidas': 'sports brand',
                'mcdonalds': 'fast food restaurant',
                'starbucks': 'coffee shop'
            };

            for (const [brand, replacement] of Object.entries(brandReplacements)) {
                const regex = new RegExp(`\\b${brand}\\b`, 'gi');
                processedPrompt = processedPrompt.replace(regex, replacement);
            }

            // Clean up spacing
            processedPrompt = processedPrompt.replace(/\s+/g, ' ').trim();

            return {
                original: originalPrompt,
                optimized: processedPrompt,
                method: 'lightweight_rules'
            };

        } catch (error) {
            logger.error('Lightweight optimization failed:', error.message);
            return {
                original: originalPrompt,
                optimized: originalPrompt,
                method: 'none'
            };
        }
    }

    async validatePrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Prompt is required and must be a string');
        }

        if (prompt.length > 1000) {
            throw new Error('Prompt must be less than 1000 characters');
        }

        // Minimal harmful content check - only obvious violations
        const harmfulPatterns = [
            /\b(explicit|nsfw|nude|naked)\b/i,
            /\b(violence|blood|gore|kill)\b/i,
            /\b(hate|racist|discrimination)\b/i,
            /\b(weapon|gun|knife|bomb)\b/i
        ];

        for (const pattern of harmfulPatterns) {
            if (pattern.test(prompt)) {
                throw new Error('Prompt contains inappropriate content');
            }
        }

        return true;
    }

    async generateImage(prompt, userId, options = {}) {
        try {
            logger.info(`Generating image for user ${userId} with prompt: ${prompt}`);
            
            await this.validatePrompt(prompt);

            // Try different optimization strategies
            const strategies = [
                () => ({ original: prompt, optimized: prompt, method: 'none' }), // No optimization first
                () => this.lightweightPromptOptimization(prompt), // Light rules
                () => this.optimizePromptMinimally(prompt) // AI optimization as last resort
            ];

            let lastError = null;

            for (let i = 0; i < strategies.length; i++) {
                try {
                    const promptResult = await strategies[i]();
                    const finalPrompt = promptResult.optimized;
                    
                    logger.info(`Trying strategy ${i + 1}: ${promptResult.method}`);
                    
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
                                    modelUsed: model
                                };
                            }
                        } catch (modelError) {
                            logger.warn(`Model ${model} failed: ${modelError.message}`);
                            lastError = modelError;
                            
                            // If it's a content policy error, try next strategy immediately
                            if (modelError.message.includes('content policy') || 
                                modelError.message.includes('safety') ||
                                modelError.message.includes('blocked')) {
                                break; // Break model loop, try next strategy
                            }
                        }
                    }
                } catch (strategyError) {
                    logger.warn(`Strategy ${i + 1} failed: ${strategyError.message}`);
                    lastError = strategyError;
                }
            }

            // If all strategies failed, throw the last error
            throw lastError || new Error('All generation strategies failed');

        } catch (error) {
            logger.error(`Error generating image: ${error.message}`);
            
            if (error.message && error.message.includes('quota')) {
                throw new Error('Rate limit exceeded. Please try again later.');
            } else if (error.message && (error.message.includes('content policy') || error.message.includes('safety'))) {
                throw new Error('Content policy violation. Please try rephrasing your request with simpler, more neutral language.');
            }
            
            throw error;
        }
    }

    // IMPROVED: Generate with specific model and better safety settings
    async generateWithModel(prompt, modelName, options = {}) {
        try {
            await this.testAuth();
            const accessToken = await this.getAccessToken();
            const fetch = require('node-fetch');
            
            const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${modelName}:predict`;
            
            // IMPROVED: More permissive safety settings
            const requestBody = {
                instances: [
                    {
                        prompt: prompt
                    }
                ],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: options.aspectRatio || "1:1",
                    // More permissive safety settings
                    safetyFilterLevel: "block_few", // Less restrictive than default
                    personGeneration: "allow_adult", // Allow adult person generation
                    // Remove the restrictive safetySetting we had before
                }
            };

            logger.info(`Making request to ${modelName}:`, url);

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
                    if (responseText.includes('content policy') || 
                        responseText.includes('safety') || 
                        responseText.includes('blocked')) {
                        throw new Error('Content policy violation');
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
