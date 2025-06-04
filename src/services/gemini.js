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

    // NEW: Smart prompt preprocessing to avoid content policy issues
    preprocessPrompt(originalPrompt) {
        try {
            logger.info(`Preprocessing prompt: ${originalPrompt}`);
            
            // First, perform basic validation
            if (!originalPrompt || typeof originalPrompt !== 'string') {
                throw new Error('Prompt is required and must be a string');
            }

            if (originalPrompt.length > 1000) {
                throw new Error('Prompt must be less than 1000 characters');
            }

            // Start with the original prompt
            let processedPrompt = originalPrompt.trim();

            // 1. Replace brand names with generic terms to avoid trademark issues
            const brandReplacements = {
                'nutramilk': 'nutritional milk product',
                'coca cola': 'cola drink',
                'pepsi': 'cola beverage',
                'nike': 'athletic wear',
                'adidas': 'sports brand',
                'apple': 'tech device',
                'samsung': 'electronic device',
                'bmw': 'luxury car',
                'mercedes': 'premium vehicle'
            };

            // Apply brand replacements (case insensitive)
            for (const [brand, replacement] of Object.entries(brandReplacements)) {
                const regex = new RegExp(brand, 'gi');
                processedPrompt = processedPrompt.replace(regex, replacement);
            }

            // 2. Enhance demographic descriptions to be more AI-friendly
            const demographicEnhancements = {
                'african family': 'family of African descent',
                'indian family': 'family of South Asian heritage',
                'asian family': 'family of Asian heritage',
                'elderly person': 'mature adult',
                'kids': 'children',
                'teenage': 'young adult'
            };

            for (const [original, enhanced] of Object.entries(demographicEnhancements)) {
                const regex = new RegExp(original, 'gi');
                processedPrompt = processedPrompt.replace(regex, enhanced);
            }

            // 3. Add context and style guidance to make the prompt more specific and AI-friendly
            const contextualAdditions = [];
            
            // Add professional photography context if not present
            if (!processedPrompt.toLowerCase().includes('photo') && 
                !processedPrompt.toLowerCase().includes('image') && 
                !processedPrompt.toLowerCase().includes('picture')) {
                contextualAdditions.push('professional photograph of');
            }

            // Add lighting guidance for better results
            if (!processedPrompt.toLowerCase().includes('lighting') && 
                !processedPrompt.toLowerCase().includes('light')) {
                contextualAdditions.push('with natural lighting');
            }

            // Add quality modifiers
            const qualityModifiers = ['high quality', 'detailed', 'realistic'];
            const hasQualityModifier = qualityModifiers.some(modifier => 
                processedPrompt.toLowerCase().includes(modifier)
            );
            
            if (!hasQualityModifier) {
                contextualAdditions.push('high quality and detailed');
            }

            // 4. Construct the final prompt
            if (contextualAdditions.length > 0) {
                processedPrompt = `${contextualAdditions.join(', ')} ${processedPrompt}`;
            }

            // 5. Add style guidance to avoid potential issues
            const styleGuidance = [
                'commercial photography style',
                'clean background',
                'professional composition'
            ];

            processedPrompt += `, ${styleGuidance.join(', ')}`;

            // 6. Final safety check - remove any potentially problematic patterns
            const safetyReplacements = {
                'nude': 'natural',
                'naked': 'plain',
                'sexy': 'attractive',
                'hot': 'appealing'
            };

            for (const [unsafe, safe] of Object.entries(safetyReplacements)) {
                const regex = new RegExp(unsafe, 'gi');
                processedPrompt = processedPrompt.replace(regex, safe);
            }

            logger.info(`Preprocessed prompt: ${processedPrompt}`);
            
            return {
                original: originalPrompt,
                processed: processedPrompt,
                changes: processedPrompt !== originalPrompt
            };

        } catch (error) {
            logger.error('Error preprocessing prompt:', error.message);
            throw error;
        }
    }

    // Updated validation that's more precise
    async validatePrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Prompt is required and must be a string');
        }

        if (prompt.length > 1000) {
            throw new Error('Prompt must be less than 1000 characters');
        }

        // Check for genuinely harmful content (more precise patterns)
        const harmfulPatterns = [
            /\bexplicit\b|\bnsfw\b|\bnude\b|\bnaked\b|\bsex\b/i,
            /\bviolence\b|\bblood\b|\bgore\b|\bdeath\b|\bkill\b/i,
            /\bhate\b|\bdiscrimination\b|\bracist\b/i
        ];

        // More precise celebrity detection (full names or very specific terms)
        const celebrityPatterns = [
            // Full names only, not partial matches
            /\bsachin tendulkar\b|\bvirat kohli\b|\bms dhoni\b|\brohit sharma\b/i,
            /\bshah rukh khan\b|\bamitabh bachchan\b|\bsalman khan\b|\baamir khan\b/i,
            /\bakshay kumar\b|\bdeepika padukone\b|\bpriyanka chopra\b/i,
            /\bnarendra modi\b|\brahul gandhi\b|\barvind kejriwal\b/i,
            /\belon musk\b|\bbill gates\b|\bjeff bezos\b/i,
            /\bdonald trump\b|\bjoe biden\b/i,
            /\bleonardo dicaprio\b|\bbrad pitt\b|\bangelina jolie\b/i,
            /\btaylor swift\b|\bbeyonce\b|\brihanna\b/i,
            /\bcristiano ronaldo\b|\blionel messi\b/i
        ];

        for (const pattern of harmfulPatterns) {
            if (pattern.test(prompt)) {
                throw new Error('Prompt contains inappropriate content');
            }
        }

        for (const pattern of celebrityPatterns) {
            if (pattern.test(prompt)) {
                throw new Error('Content policy violation. Please avoid prompts mentioning specific celebrities or public figures by name.');
            }
        }

        return true;
    }

    async generateImage(prompt, userId) {
        try {
            logger.info(`Generating image for user ${userId} with original prompt: ${prompt}`);
            
            // NEW: Preprocess the prompt to avoid common issues
            const promptResult = this.preprocessPrompt(prompt);
            const finalPrompt = promptResult.processed;
            
            if (promptResult.changes) {
                logger.info(`Prompt was enhanced from: "${promptResult.original}" to: "${finalPrompt}"`);
            }

            // Validate the processed prompt
            await this.validatePrompt(finalPrompt);

            // Test authentication before making the request
            try {
                await this.testAuth();
                logger.info('Authentication test passed');
                logger.info('Skipping detailed permission validation, proceeding with image generation');
                
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
                        promptWasModified: promptResult.changes
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
                promptWasModified: promptResult.changes
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
                throw new Error('Content policy violation. The image request could not be processed due to safety guidelines.');
            } else if (error.message && error.message.includes('Prompt contains inappropriate content')) {
                // This is from our own validation
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
            
            // Log the response structure for debugging (without sensitive data)
            logger.debug('Response structure:', {
                hasPredictions: !!result.predictions,
                predictionsLength: result.predictions ? result.predictions.length : 0,
                firstPredictionKeys: result.predictions && result.predictions[0] ? Object.keys(result.predictions[0]) : []
            });

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

            // Log the full response structure for debugging
            logger.error('Unexpected API response structure:', JSON.stringify(result, null, 2));
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

            // Log request for debugging (excluding sensitive data)
            logger.debug('Sending request with structure:', {
                prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
                model: 'imagen-3.0-generate-001'
            });

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
