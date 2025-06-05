const { VertexAI } = require('@google-cloud/vertexai');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const config = require('../utils/config');
const PromptGuard = require('../utils/promptGuard');

class GeminiService {
    constructor() {
        try {
            if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
                throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable');
            }

            this.config = config.gemini;
            this.loadAndSanitizeCredentials();
            this.projectId = this.config.projectId || this.credentials.project_id;
            this.location = this.config.location;

            this.setupCredentialsFile();
            this.initializeVertexAI();
            this.initializePromptGuard();

            logger.info('Successfully initialized Vertex AI client');
        } catch (error) {
            logger.error(`Error initializing Vertex AI: ${error.message}`);
            throw new Error('Failed to initialize image generation service');
        }
    }

    loadAndSanitizeCredentials() {
        try {
            const credString = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
            logger.info(`Credential string length: ${credString.length}`);
            
            this.credentials = JSON.parse(credString);
            
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
            const privateKey = this.credentials.private_key;
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

    initializeVertexAI() {
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

        // Initialize text model for prompt transformation
        this.textModel = this.vertexai.preview.getGenerativeModel({
            model: this.config.textModel
        });
    }

    initializePromptGuard() {
        this.promptGuard = new PromptGuard(this.textModel, this.config);
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

    async validatePrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Prompt is required and must be a string');
        }

        if (prompt.length > 1000) {
            throw new Error('Prompt must be less than 1000 characters');
        }

        return true;
    }

    async generateImage(prompt, userId, options = {}) {
        try {
            logger.info(`Generating image for user ${userId} with prompt: ${prompt}`);
            
            await this.validatePrompt(prompt);

            // Direct generation with safe parameters
            const result = await this.generateWithSafeParams(prompt, options);
            
            if (result && result.base64) {
                logger.info('Direct generation successful');
                return {
                    ...result,
                    promptUsed: prompt,
                    originalPrompt: prompt,
                    promptWasTransformed: false,
                    transformationMethod: 'none',
                    modelUsed: this.config.imageModels[0],
                    detectedIssues: []
                };
            }

            // Fallback strategies with enhanced prompts
            const strategies = [
                // Strategy 1: Enhanced cultural context
                async () => ({
                    original: prompt,
                    transformed: this.enhancePromptWithContext(prompt),
                    method: 'cultural_enhancement'
                }),
                
                // Strategy 2: Artistic interpretation
                async () => ({
                    original: prompt,
                    transformed: this.createArtisticVersion(prompt),
                    method: 'artistic_interpretation'
                }),
                
                // Strategy 3: Documentary style
                async () => ({
                    original: prompt,
                    transformed: this.createDocumentaryStyle(prompt),
                    method: 'documentary_style'
                })
            ];

            let lastError = null;

            for (let i = 0; i < strategies.length; i++) {
                try {
                    const promptResult = await strategies[i]();
                    const finalPrompt = promptResult.transformed;
                    
                    logger.info(`Trying strategy ${i + 1}: ${promptResult.method}`);
                    logger.info(`Using prompt: ${finalPrompt}`);
                    
                    for (const model of this.config.imageModels) {
                        try {
                            logger.info(`Attempting with model: ${model}`);
                            const result = await this.generateWithModel(finalPrompt, model, options);
                            
                            if (result && result.base64) {
                                logger.info(`Success with model ${model} and strategy ${promptResult.method}`);
                                return {
                                    ...result,
                                    promptUsed: finalPrompt,
                                    originalPrompt: prompt,
                                    promptWasTransformed: promptResult.original !== promptResult.transformed,
                                    transformationMethod: promptResult.method,
                                    modelUsed: model,
                                    detectedIssues: []
                                };
                            }
                        } catch (modelError) {
                            logger.warn(`Model ${model} failed: ${modelError.message}`);
                            lastError = modelError;
                        }
                    }
                } catch (strategyError) {
                    logger.warn(`Strategy ${i + 1} failed: ${strategyError.message}`);
                    lastError = strategyError;
                }
            }

            throw new Error('All generation strategies failed. Please try a different prompt or try again later.');

        } catch (error) {
            logger.error(`Error generating image: ${error.message}`);
            
            if (this.isQuotaError(error.message)) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }
            
            throw error;
        }
    }

    enhancePromptWithContext(prompt) {
        return `High-quality portrait photograph, ${prompt}, natural lighting, authentic cultural setting, warm atmosphere, photojournalistic style, documentary photography, human interest story, real life moment, candid expression, beautiful natural scene`;
    }

    createArtisticVersion(prompt) {
        return `Fine art portrait, ${prompt}, painted in warm earth tones, soft natural lighting, cultural authenticity, dignified representation, masterpiece quality, museum-worthy composition, human warmth and connection, timeless beauty`;
    }

    createDocumentaryStyle(prompt) {
        return `Documentary style photograph, ${prompt}, natural environment, authentic moment, cultural sensitivity, respectful portrayal, real life scene, journalistic quality, human story, genuine expression, meaningful composition`;
    }

    // NEW: Safe parameter generation method
    async generateWithSafeParams(prompt, options = {}) {
        try {
            await this.testAuth();
            const accessToken = await this.getAccessToken();
            const fetch = require('node-fetch');
            
            const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${this.config.imageModels[0]}:predict`;
            
            // FIXED: Remove personGeneration parameter that's causing the error
            const requestBody = {
                instances: [
                    {
                        prompt: prompt
                    }
                ],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: options.aspectRatio || "1:1",
                    safetyFilterLevel: "block_few", // Changed from "block_only_high" for better compatibility
                    includeRaiInfo: false
                    // REMOVED: personGeneration: "allow_all" - This was causing the 400 error
                }
            };

            logger.info(`Making safe request to ${this.config.imageModels[0]}:`, url);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            const responseText = await response.text();
            logger.info(`Safe generation response status: ${response.status}`);

            if (!response.ok) {
                logger.error(`Safe generation error response:`, responseText);
                throw new Error(`API error: ${response.status} - ${responseText}`);
            }

            let result;
            try {
                result = JSON.parse(responseText);
            } catch (parseError) {
                throw new Error('Invalid response format from image generation API');
            }
            
            if (result.predictions && result.predictions[0]) {
                const prediction = result.predictions[0];
                
                if (prediction.bytesBase64Encoded && prediction.bytesBase64Encoded.length > 0) {
                    return {
                        base64: prediction.bytesBase64Encoded,
                        mimeType: prediction.mimeType || 'image/png'
                    };
                }
            }

            throw new Error('No image data in response');

        } catch (error) {
            logger.error(`Safe generation failed:`, error.message);
            throw error;
        }
    }

    // UPDATED: Remove the old generateWithRelaxedFilters method and update generateWithModel
    async generateWithModel(prompt, modelName, options = {}) {
        try {
            await this.testAuth();
            const accessToken = await this.getAccessToken();
            const fetch = require('node-fetch');
            
            const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${modelName}:predict`;
            
            // FIXED: Remove personGeneration parameter
            const requestBody = {
                instances: [
                    {
                        prompt: prompt
                    }
                ],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: options.aspectRatio || "1:1",
                    safetyFilterLevel: "block_few", // More permissive than "block_only_high"
                    // REMOVED: personGeneration: "allow_all"
                }
            };

            logger.info(`Making request to ${modelName}:`, url);
            logger.info('Request parameters:', requestBody.parameters);

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
                throw new Error(`${modelName} API error: ${response.status} - ${responseText}`);
            }

            let result;
            try {
                result = JSON.parse(responseText);
            } catch (parseError) {
                throw new Error('Invalid response format from image generation API');
            }
            
            if (result.predictions && result.predictions[0]) {
                const prediction = result.predictions[0];
                
                if (prediction.bytesBase64Encoded && prediction.bytesBase64Encoded.length > 0) {
                    return {
                        base64: prediction.bytesBase64Encoded,
                        mimeType: prediction.mimeType || 'image/png'
                    };
                }
            }

            logger.error(`Unexpected response structure from ${modelName}:`, JSON.stringify(result, null, 2));

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

    isContentPolicyError(errorMessage) {
        return this.config.apiErrorStrings.contentPolicy.some(errorStr => 
            errorMessage.toLowerCase().includes(errorStr.toLowerCase())
        );
    }

    isQuotaError(errorMessage) {
        return this.config.apiErrorStrings.quota.some(errorStr => 
            errorMessage.toLowerCase().includes(errorStr.toLowerCase())
        );
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
