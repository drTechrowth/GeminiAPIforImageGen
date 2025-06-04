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

            // Enhanced credential validation
            this.validateAndParseCredentials();
            this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || this.credentials.project_id;
            this.location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';

            // Create temporary credentials file for Google libraries
            this.setupCredentialsFile();

            // Initialize Google Auth first
            this.auth = new GoogleAuth({
                keyFile: this.credentialsPath,
                scopes: ['https://www.googleapis.com/auth/cloud-platform']
            });

            // Initialize Vertex AI with the credentials file path
            this.vertexai = new VertexAI({
                project: this.projectId,
                location: this.location,
                googleAuthOptions: {
                    keyFile: this.credentialsPath,
                    scopes: ['https://www.googleapis.com/auth/cloud-platform']
                }
            });

            logger.info('Successfully initialized Vertex AI client');
        } catch (error) {
            logger.error(`Error initializing Vertex AI: ${error.message}`);
            throw new Error('Failed to initialize image generation service');
        }
    }

    validateAndParseCredentials() {
        try {
            // Get the raw credential string
            const credString = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
            logger.info(`Credential string length: ${credString.length}`);
            
            // Log first and last 50 characters to check for corruption
            logger.info(`First 50 chars: ${credString.substring(0, 50)}`);
            logger.info(`Last 50 chars: ${credString.substring(credString.length - 50)}`);
            
            // Try to parse the JSON
            this.credentials = JSON.parse(credString);
            
            // Check private key format in detail
            const privateKey = this.credentials.private_key;
            logger.info(`Private key starts with: ${privateKey.substring(0, 30)}`);
            logger.info(`Private key ends with: ${privateKey.substring(privateKey.length - 30)}`);
            logger.info(`Private key contains \\n: ${privateKey.includes('\\n')}`);
            logger.info(`Private key contains actual newlines: ${privateKey.includes('\n')}`);
            
            // Validate required fields
            const requiredFields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id', 'auth_uri', 'token_uri'];
            const missingFields = requiredFields.filter(field => !this.credentials[field]);
            
            if (missingFields.length > 0) {
                throw new Error(`Missing required credential fields: ${missingFields.join(', ')}`);
            }
            
            // Validate service account type
            if (this.credentials.type !== 'service_account') {
                throw new Error(`Invalid credential type: ${this.credentials.type}. Expected: service_account`);
            }
            
            // Validate private key format
            if (!this.credentials.private_key.includes('-----BEGIN PRIVATE KEY-----')) {
                throw new Error('Invalid private key format. Missing PEM headers.');
            }
            
            // Fix private key newlines - this is the most common issue
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
            logger.info(`Project ID: ${this.credentials.project_id}`);
            
        } catch (parseError) {
            logger.error('Failed to parse credentials JSON:', parseError.message);
            logger.error('First 100 characters of credential string:', 
                process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.substring(0, 100));
            throw new Error(`Invalid credential JSON format: ${parseError.message}`);
        }
    }

    setupCredentialsFile() {
        try {
            // Create /tmp directory if it doesn't exist
            const tmpDir = '/tmp';
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }

            // Write credentials to temporary file with proper formatting
            this.credentialsPath = path.join(tmpDir, `gcp-credentials-${Date.now()}.json`);
            const credentialsContent = JSON.stringify(this.credentials, null, 2);
            fs.writeFileSync(this.credentialsPath, credentialsContent, { mode: 0o600 });
            
            // Verify the file was written correctly
            const writtenContent = fs.readFileSync(this.credentialsPath, 'utf8');
            const parsedWritten = JSON.parse(writtenContent);
            
            if (parsedWritten.client_email !== this.credentials.client_email) {
                throw new Error('Credential file verification failed');
            }
            
            // Set environment variable for Google libraries
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
            logger.info(`Using project: ${this.projectId}`);
            logger.info(`Using service account: ${this.credentials.client_email}`);
            
            // Get an authenticated client
            const client = await this.auth.getClient();
            
            // Test by getting an access token
            const accessToken = await client.getAccessToken();
            
            if (accessToken && accessToken.token) {
                logger.info('Authentication test successful');
                logger.info(`Token type: ${typeof accessToken.token}`);
                logger.info(`Token length: ${accessToken.token.length}`);
                return true;
            } else {
                throw new Error('No access token received');
            }
        } catch (error) {
            logger.error('Authentication test failed:', {
                message: error.message,
                code: error.code,
                stack: error.stack?.split('\n')[0] // Just first line of stack
            });
            
            // Provide specific guidance based on error type
            if (error.message.includes('Invalid JWT Signature')) {
                throw new Error('JWT signature validation failed. This usually indicates corrupted service account credentials. Please regenerate your service account key.');
            } else if (error.message.includes('invalid_grant')) {
                throw new Error('Invalid grant error. Please check your service account permissions and ensure the key is not expired.');
            } else if (error.message.includes('Forbidden')) {
                throw new Error('Access denied. Ensure your service account has the required IAM roles (Vertex AI User, Storage Admin).');
            }
            
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }

    // Add method to validate service account permissions
    async validateServiceAccountPermissions() {
        try {
            const { google } = require('googleapis');
            const auth = await this.auth.getClient();
            
            // Test Cloud Resource Manager API access
            const cloudresourcemanager = google.cloudresourcemanager({ 
                version: 'v1', 
                auth: auth 
            });
            
            // Try to get project information
            const project = await cloudresourcemanager.projects.get({
                projectId: this.projectId
            });
            
            logger.info(`Project validation successful: ${project.data.name}`);
            
            // Test Vertex AI API access by trying to list models
            const aiplatform = google.aiplatform({ 
                version: 'v1', 
                auth: auth 
            });
            
            // This will test if we have proper Vertex AI permissions
            const modelsResponse = await aiplatform.projects.locations.models.list({
                parent: `projects/${this.projectId}/locations/${this.location}`
            });
            
            logger.info('Vertex AI permissions validated successfully');
            return true;
            
        } catch (error) {
            logger.error('Service account permission validation failed:', error.message);
            
            if (error.code === 403) {
                throw new Error('Insufficient permissions. Please ensure your service account has these roles: Vertex AI User, Storage Object Admin, and Project Viewer.');
            }
            
            throw error;
        }
    }

    // NEW: AI-powered prompt optimization using Gemini text model
    async optimizePromptWithAI(originalPrompt) {
        try {
            logger.info(`Optimizing prompt with AI: ${originalPrompt}`);
            
            // Use Gemini Pro for text generation
            const textModel = this.vertexai.preview.getGenerativeModel({
                model: 'gemini-1.5-pro-preview-0514'
            });

            const optimizationPrompt = `You are an expert prompt engineer for AI image generation. Your task is to optimize the following image generation prompt to:

1. Remove or replace any brand names with generic descriptions
2. Ensure the description is detailed and specific for better image generation
3. Use professional photography terminology
4. Avoid any content that might trigger safety filters
5. Make the prompt clear and actionable for an AI image generator
6. Keep the core meaning and intent intact
7. Add helpful context about composition, lighting, and style

Original prompt: "${originalPrompt}"

Please provide ONLY the optimized prompt without any explanation or additional text. The response should be a single, well-crafted prompt ready for image generation.

Guidelines:
- Replace brand names with generic terms (e.g., "Coca Cola" → "cola beverage")
- Use inclusive and respectful language
- Add professional photography context
- Specify composition and lighting details
- Ensure family-friendly content
- Make it specific but not overly complex`;

            const result = await textModel.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: optimizationPrompt }]
                }],
                generationConfig: {
                    temperature: 0.3, // Lower temperature for more consistent results
                    topK: 20,
                    topP: 0.8,
                    maxOutputTokens: 500
                }
            });

            if (result.response && result.response.candidates && result.response.candidates[0]) {
                const optimizedPrompt = result.response.candidates[0].content.parts[0].text.trim();
                
                logger.info(`AI-optimized prompt: ${optimizedPrompt}`);
                
                return {
                    original: originalPrompt,
                    optimized: optimizedPrompt,
                    method: 'ai_powered'
                };
            } else {
                logger.warn('No response from AI optimization, falling back to rule-based');
                return this.fallbackPromptOptimization(originalPrompt);
            }

        } catch (error) {
            logger.error('AI prompt optimization failed:', error.message);
            logger.info('Falling back to rule-based optimization');
            return this.fallbackPromptOptimization(originalPrompt);
        }
    }

    // Fallback rule-based prompt optimization (simplified version of old preprocessing)
    fallbackPromptOptimization(originalPrompt) {
        try {
            let processedPrompt = originalPrompt.trim();

            // Basic brand name replacements
            const brandReplacements = {
                'nutramilk': 'nutritional milk product',
                'coca cola': 'cola drink',
                'pepsi': 'cola beverage',
                'nike': 'athletic wear',
                'adidas': 'sports brand'
            };

            for (const [brand, replacement] of Object.entries(brandReplacements)) {
                const regex = new RegExp(brand, 'gi');
                processedPrompt = processedPrompt.replace(regex, replacement);
            }

            // Add basic professional context
            if (!processedPrompt.toLowerCase().includes('professional')) {
                processedPrompt = `Professional photograph of ${processedPrompt}`;
            }

            return {
                original: originalPrompt,
                optimized: processedPrompt,
                method: 'rule_based'
            };

        } catch (error) {
            logger.error('Fallback optimization failed:', error.message);
            return {
                original: originalPrompt,
                optimized: originalPrompt,
                method: 'none'
            };
        }
    }

    // Basic validation (simplified)
    async validatePrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Prompt is required and must be a string');
        }

        if (prompt.length > 1000) {
            throw new Error('Prompt must be less than 1000 characters');
        }

        // Basic harmful content check
        const harmfulPatterns = [
            /\bexplicit\b|\bnsfw\b|\bnude\b|\bnaked\b/i,
            /\bviolence\b|\bblood\b|\bgore\b/i,
            /\bhate\b|\bdiscrimination\b|\bracist\b/i
        ];

        for (const pattern of harmfulPatterns) {
            if (pattern.test(prompt)) {
                throw new Error('Prompt contains inappropriate content');
            }
        }

        return true;
    }

    async generateImage(prompt, userId) {
        try {
            logger.info(`Generating image for user ${userId} with original prompt: ${prompt}`);
            
            // Validate the original prompt
            await this.validatePrompt(prompt);

            // NEW: Use AI to optimize the prompt
            const promptResult = await this.optimizePromptWithAI(prompt);
            const finalPrompt = promptResult.optimized;
            
            logger.info(`Prompt optimization method: ${promptResult.method}`);
            if (promptResult.original !== promptResult.optimized) {
                logger.info(`Prompt optimized from: "${promptResult.original}" to: "${finalPrompt}"`);
            }

            // Test authentication before making the request
            try {
                await this.testAuth();
                logger.info('Authentication test passed');
                
            } catch (authError) {
                logger.error('Authentication test failed:', authError.message);
                throw authError;
            }

            logger.info('Sending request to generate image...');

            // Try using the REST API approach first
            try {
                const accessToken = await this.getAccessToken();
                const response = await this.generateImageWithRestAPI(finalPrompt, accessToken);
                
                if (response && response.base64) {
                    logger.info(`Successfully generated image for user ${userId} using REST API`);
                    return {
                        ...response,
                        promptUsed: finalPrompt,
                        originalPrompt: prompt,
                        promptWasOptimized: promptResult.original !== promptResult.optimized,
                        optimizationMethod: promptResult.method
                    };
                }
            } catch (restError) {
                logger.warn(`REST API failed: ${restError.message}, trying fallback method`);
                
                // If it's a content policy error, don't try fallback
                if (restError.message.includes('content policy') || restError.message.includes('safety')) {
                    throw restError;
                }
            }

            // Fallback to client library approach
            logger.info('Attempting fallback to client library approach...');
            const result = await this.generateImageWithClient(finalPrompt, userId);
            
            return {
                ...result,
                promptUsed: finalPrompt,
                originalPrompt: prompt,
                promptWasOptimized: promptResult.original !== promptResult.optimized,
                optimizationMethod: promptResult.method
            };

        } catch (error) {
            logger.error(`Error generating image: ${error.message}`);
            
            // Enhanced error handling with specific messages
            if (error.message && error.message.includes('quota')) {
                throw new Error('Rate limit exceeded. Please try again later.');
            } else if (error.message && (error.message.includes('JWT') || error.message.includes('invalid_grant'))) {
                throw new Error('Authentication failed due to invalid credentials. Please regenerate your service account key.');
            } else if (error.message && error.message.includes('ENOENT')) {
                logger.error('File system error:', error);
                throw new Error('Service configuration error. Please contact support.');
            } else if (error.message && (error.message.includes('permission') || error.message.includes('access') || error.code === 403)) {
                throw new Error('Insufficient permissions. Please verify service account has these roles: Vertex AI User, Storage Object Admin, Project Viewer.');
            } else if (error.code === 'ENAMETOOLONG') {
                logger.error('Path too long error - likely credential configuration issue:', error);
                throw new Error('Configuration error. Please verify credential setup.');
            } else if (error.message && (error.message.includes('content policy') || error.message.includes('safety'))) {
                throw new Error('Content policy violation. The image request could not be processed due to safety guidelines. Please try rephrasing your request.');
            } else if (error.message && error.message.includes('Prompt contains inappropriate content')) {
                throw error;
            }
            
            throw error;
        }
    }

    async generateImageWithRestAPI(prompt, accessToken) {
        try {
            const fetch = require('node-fetch');
            
            const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/imagegeneration@006:predict`;
            
            const requestBody = {
                instances: [
                    {
                        prompt: prompt
                    }
                ],
                parameters: {
                    sampleCount: 1
                }
            };

            logger.info('Making REST API request to:', url);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error('REST API error response:', errorText);
                
                // Check for specific error types
                if (response.status === 400 && errorText.includes('content policy')) {
                    throw new Error('Content policy violation. The image request could not be processed due to safety guidelines.');
                }
                
                throw new Error(`REST API error: ${response.status} ${errorText}`);
            }

            const result = await response.json();
            logger.info('REST API response received');
            
            if (result.predictions && result.predictions[0] && result.predictions[0].bytesBase64Encoded) {
                return {
                    base64: result.predictions[0].bytesBase64Encoded,
                    mimeType: 'image/png'
                };
            }

            // If no image data but response was successful, it might be a content policy issue
            if (result.predictions && result.predictions.length === 0) {
                logger.warn('Empty predictions array - likely content policy violation');
                throw new Error('Content policy violation. The image request could not be processed due to safety guidelines.');
            }

            throw new Error('No image data in REST API response - this may indicate a content policy violation or API issue');

        } catch (error) {
            logger.error('REST API generation failed:', error.message);
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

    async generateImageWithClient(prompt, userId) {
        try {
            logger.info('Trying client library approach...');

            // Use the correct image generation model
            const model = this.vertexai.preview.getGenerativeModel({
                model: 'imagen-3.0-generate-001'
            });

            // Create the request for image generation
            const request = {
                contents: [{
                    role: 'user',
                    parts: [{
                        text: `Generate an image: ${prompt}`
                    }]
                }],
                generationConfig: {
                    candidateCount: 1,
                    maxOutputTokens: 2048,
                    temperature: 0.4,
                }
            };

            // Generate the image
            const response = await model.generateContent(request);
            logger.info('Received response from image generation API');

            // Check if response contains image data
            if (response.response && response.response.candidates && response.response.candidates[0]) {
                const candidate = response.response.candidates[0];
                
                // Check for image parts in the response
                if (candidate.content && candidate.content.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.inlineData && part.inlineData.data) {
                            logger.info(`Successfully generated image for user ${userId}`);
                            return {
                                base64: part.inlineData.data,
                                mimeType: part.inlineData.mimeType || 'image/png'
                            };
                        }
                    }
                }
            }

            throw new Error('No image data found in response - this may indicate a content policy violation');

        } catch (error) {
            logger.error('Client library generation failed:', error.message);
            
            // Check if it's a content policy error
            if (error.message && (error.message.includes('content policy') || error.message.includes('safety'))) {
                throw new Error('Content policy violation. The image request could not be processed due to safety guidelines.');
            }
            
            throw error;
        }
    }

    // Cleanup method to remove temporary credentials file
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
