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
                googleAuthOptions: {
                    credentials: this.credentials
                }
            });

            // Store project details for image generation
            this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || this.credentials.project_id;
            this.location = process.env.GOOGLE_CLOUD_REGION || 'us-central1';

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
                
                // If no image data found, check for text response that might contain image info
                if (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) {
                    const textResponse = candidate.content.parts[0].text;
                    try {
                        const parsedResponse = JSON.parse(textResponse);
                        if (parsedResponse.image) {
                            logger.info(`Successfully generated image for user ${userId}`);
                            return parsedResponse.image;
                        }
                    } catch (parseError) {
                        logger.debug('Response is not JSON, treating as plain text');
                    }
                }
            }

            logger.error('No image data found in response:', JSON.stringify(response.response, null, 2));
            throw new Error('No image was generated in the response');

        } catch (error) {
            logger.error(`Error generating image: ${error.message}`);
            
            // Enhanced error handling with specific messages
            if (error.message && error.message.includes('quota')) {
                throw new Error('Rate limit exceeded. Please try again later.');
            } else if (error.message && (error.message.includes('scope') || error.message.includes('authenticate') || error.message.includes('Unable to authenticate'))) {
                logger.error('Authentication error details:', {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                });
                throw new Error('Authentication failed. Please verify service account permissions.');
            } else if (error.message && error.message.includes('ENOENT')) {
                logger.error('File system error:', error);
                throw new Error('Service configuration error. Please contact support.');
            } else if (error.message && (error.message.includes('permission') || error.message.includes('access'))) {
                throw new Error('Insufficient permissions. Please verify service account has the required roles.');
            } else if (error.code === 'ENAMETOOLONG') {
                logger.error('Path too long error - likely credential configuration issue:', error);
                throw new Error('Configuration error. Please verify credential setup.');
            }
            
            throw new Error(`Failed to generate image: ${error.message}`);
        }
    }

    // Alternative method using Imagen API directly
    async generateImageWithImagen(prompt, userId) {
        try {
            logger.info(`Generating image with Imagen for user ${userId} with prompt: ${prompt}`);
            
            // Validate the prompt
            await this.validatePrompt(prompt);

            // Get the Imagen model
            const model = this.vertexai.getGenerativeModel({
                model: 'imagegeneration@006'
            });

            const request = {
                contents: [{
                    role: 'user',
                    parts: [{
                        text: prompt
                    }]
                }]
            };

            const response = await model.generateContent(request);
            
            if (response.response && response.response.candidates && response.response.candidates[0]) {
                const candidate = response.response.candidates[0];
                
                if (candidate.content && candidate.content.parts) {
                    for (const part of candidate.content.parts) {
                        if (part.inlineData && part.inlineData.data) {
                            logger.info(`Successfully generated image with Imagen for user ${userId}`);
                            return {
                                base64: part.inlineData.data,
                                mimeType: part.inlineData.mimeType || 'image/png'
                            };
                        }
                    }
                }
            }

            throw new Error('No image data found in Imagen response');

        } catch (error) {
            logger.error(`Error with Imagen generation: ${error.message}`);
            // Fall back to main generation method
            return this.generateImage(prompt, userId);
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
        const unsafeContent = ['explicit', 'violence', 'hate', 'harassment', 'sexual', 'nude', 'nsfw'];
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
