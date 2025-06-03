const { VertexAI } = require('@google-cloud/vertexai');
const { GoogleAuth } = require('google-auth-library');
const { logger } = require('../utils/logger');
const config = require('../utils/config');

class GeminiService {
    constructor() {
        try {
            if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
                throw new Error('Missing GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable');
            }

            // Parse credentials to verify JSON format
            this.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

            // Initialize Vertex AI directly with credentials object
            this.vertexai = new VertexAI({
                project: process.env.GOOGLE_CLOUD_PROJECT_ID || this.credentials.project_id,
                location: process.env.GOOGLE_CLOUD_REGION || 'us-central1',
                credentials: this.credentials
            });

            logger.info('Successfully initialized Vertex AI client');
        } catch (error) {
            logger.error(`Error initializing Vertex AI: ${error.message}`);
            throw new Error('Failed to initialize image generation service');
        }
    }

    async testAuth() {
        try {
            logger.info('Testing Google Cloud authentication...');
            
            // Create a GoogleAuth instance to test authentication
            const auth = new GoogleAuth({
                credentials: this.credentials,
                scopes: ['https://www.googleapis.com/auth/cloud-platform']
            });

            // Get an authenticated client
            const client = await auth.getClient();
            
            // Test by getting an access token
            const accessToken = await client.getAccessToken();
            
            if (accessToken && accessToken.token) {
                logger.info('Authentication test successful');
                return true;
            } else {
                throw new Error('No access token received');
            }
        } catch (error) {
            logger.error('Authentication test failed:', error.message);
            throw new Error('Failed to authenticate with Google Cloud');
        }
    }

    async generateImage(prompt, userId) {
        try {
            logger.info(`Generating image for user ${userId} with prompt: ${prompt}`);
            
            // First validate the prompt
            await this.validatePrompt(prompt);

            logger.info('Sending request to generate image...');

            // Get the model - using the correct model name
            const model = this.vertexai.preview.getGenerativeModel({
                model: 'imagegeneration@006'  // Updated to latest version
            });

            // Format the request according to Vertex AI image generation requirements
            const request = {
                contents: [{
                    role: 'user',
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'object',
                        properties: {
                            image: {
                                type: 'object',
                                properties: {
                                    url: { type: 'string' },
                                    base64: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            };

            // Log request for debugging (excluding sensitive data)
            logger.debug('Sending request with structure:', {
                prompt: prompt.substring(0, 100) + '...',
                model: 'imagegeneration@006'
            });

            // Generate the image using generateContent method
            const response = await model.generateContent(request);
            logger.info('Received response from image generation API');

            // Parse the response
            const responseText = response.response.text();
            const parsedResponse = JSON.parse(responseText);

            if (parsedResponse && parsedResponse.image) {
                logger.info(`Successfully generated image for user ${userId}`);
                return {
                    url: parsedResponse.image.url,
                    base64: parsedResponse.image.base64
                };
            } else {
                logger.error('Unexpected response structure:', parsedResponse);
                throw new Error('No image was generated in the response');
            }
        } catch (error) {
            logger.error(`Error generating image: ${error.message}`);
            
            // Enhanced error handling with specific messages
            if (error.message.includes('quota') || error.message.includes('rate limit')) {
                throw new Error('Rate limit exceeded. Please try again later.');
            } else if (error.message.includes('scope') || error.message.includes('authenticate')) {
                logger.error('Authentication error details:', error);
                throw new Error('Authentication failed. Please verify service account permissions.');
            } else if (error.message.includes('ENOENT')) {
                logger.error('File system error:', error);
                throw new Error('Service configuration error. Please contact support.');
            } else if (error.message.includes('permission') || error.message.includes('access')) {
                throw new Error('Insufficient permissions. Please verify service account has the required roles.');
            }
            
            throw new Error(`Failed to generate image: ${error.message}`);
        }
    }

    async validatePrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Invalid prompt: Must be a non-empty string');
        }
        if (prompt.length > 1000) {
            throw new Error('Prompt too long: Must be under 1000 characters');
        }
        
        // Add content safety validation
        const unsafeContent = ['explicit', 'violence', 'hate', 'harassment'];
        const lowerPrompt = prompt.toLowerCase();
        
        for (const content of unsafeContent) {
            if (lowerPrompt.includes(content)) {
                throw new Error(`Invalid prompt: Contains prohibited content`);
            }
        }
        
        return true;
    }
}

module.exports = new GeminiService();
