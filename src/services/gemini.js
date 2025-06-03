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
            
            // Try to parse the JSON
            this.credentials = JSON.parse(credString);
            
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
            
            // Check for common newline issues in private key
            if (!this.credentials.private_key.includes('\n')) {
                logger.warn('Private key appears to be missing newlines. Attempting to fix...');
                this.credentials.private_key = this.credentials.private_key
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

    async generateImage(prompt, userId) {
        try {
            logger.info(`Generating image for user ${userId} with prompt: ${prompt}`);
            
            // First validate the prompt
            await this.validatePrompt(prompt);

            // Test authentication and permissions before making the request
            try {
                await this.testAuth();
                logger.info('Authentication test passed');
                
                // Also validate service account permissions
                await this.validateServiceAccountPermissions();
                logger.info('Permission validation passed, proceeding with image generation');
                
            } catch (authError) {
                logger.error('Authentication/Permission test failed:', authError.message);
                throw authError; // Re-throw the specific error
            }

            logger.info('Sending request to generate image...');

            // Try using the REST API approach first
            const accessToken = await this.getAccessToken();
            const response = await this.generateImageWithRestAPI(prompt, accessToken);
            
            if (response && response.base64) {
                logger.info(`Successfully generated image for user ${userId}`);
                return response;
            }

            // Fallback to client library approach
            return await this.generateImageWithClient(prompt, userId);

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
            }
            
            throw error; // Re-throw the original error with its message
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
                logger.error('REST API error:', errorText);
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

            throw new Error('No image data in REST API response');

        } catch (error) {
            logger.error('REST API generation failed:', error.message);
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
