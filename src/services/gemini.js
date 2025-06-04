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

    // ENHANCED: Comprehensive content policy detection
    detectProblematicContent(prompt) {
        const issues = [];
        const lowerPrompt = prompt.toLowerCase();

        // Age-related terms that trigger policies
        const agePatterns = [
            /\b(?:child|children|kid|kids|boy|girl|baby|babies|infant|toddler|teen|teenager)\b/i,
            /\b(?:\d+[\s-]?(?:year|yr)[\s-]?old|years?\s+old)\b/i,
            /\b(?:minor|juvenile|youth|young|little|small)\s+(?:person|people|human|individual)\b/i,
            /\b(?:school|student|pupil|kindergarten|preschool)\b/i
        ];

        // Problematic contexts even for adults
        const riskPatterns = [
            /\b(?:model|modeling|pose|posing|photoshoot)\b/i,
            /\b(?:cute|adorable|sweet|innocent)\s+(?:child|kid|boy|girl)\b/i,
            /\b(?:drinking|eating|consuming)\b.*\b(?:milk|formula|bottle)\b/i
        ];

        for (const pattern of agePatterns) {
            if (pattern.test(prompt)) {
                issues.push({
                    type: 'age_related',
                    pattern: pattern.toString(),
                    severity: 'high'
                });
            }
        }

        for (const pattern of riskPatterns) {
            if (pattern.test(prompt)) {
                issues.push({
                    type: 'risky_context',
                    pattern: pattern.toString(),
                    severity: 'medium'
                });
            }
        }

        return issues;
    }

    // ENHANCED: Smart prompt transformation that addresses root issues
    async smartPromptTransformation(originalPrompt) {
        try {
            const issues = this.detectProblematicContent(originalPrompt);
            
            if (issues.length === 0) {
                return {
                    original: originalPrompt,
                    transformed: originalPrompt,
                    method: 'no_issues_detected',
                    issues: []
                };
            }

            logger.info(`Detected ${issues.length} potential issues:`, issues);

            // Use AI to transform the prompt while preserving intent
            const textModel = this.vertexai.preview.getGenerativeModel({
                model: 'gemini-2.0-flash-001'
            });

            const transformationPrompt = `
Transform this image generation prompt to avoid content policy violations while preserving the core visual intent:

Original prompt: "${originalPrompt}"

Guidelines:
1. If the prompt mentions children, minors, or specific ages - transform to focus on objects, products, or abstract concepts instead
2. Replace human subjects with inanimate objects, art styles, or conceptual representations
3. If it's about food/drinks, focus on the product itself, not consumption by people
4. Maintain the essence (colors, mood, style) but remove human elements
5. Make it artistic and abstract rather than realistic
6. Use terms like "artistic representation," "conceptual design," "product photography," "still life"

Return only the transformed prompt, no explanations or quotes.
`;

            const result = await textModel.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: transformationPrompt }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    topK: 10,
                    topP: 0.5,
                    maxOutputTokens: 150
                }
            });

            const candidate = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (candidate) {
                const transformedPrompt = candidate.replace(/^["']|["']$/g, '');
                logger.info(`AI transformed prompt: ${transformedPrompt}`);
                
                return {
                    original: originalPrompt,
                    transformed: transformedPrompt,
                    method: 'ai_transformation',
                    issues: issues
                };
            } else {
                // Fallback to rule-based transformation
                return this.ruleBasedTransformation(originalPrompt, issues);
            }

        } catch (error) {
            logger.error('AI transformation failed:', error.message);
            return this.ruleBasedTransformation(originalPrompt, this.detectProblematicContent(originalPrompt));
        }
    }

    // ENHANCED: Rule-based transformation as fallback
    ruleBasedTransformation(originalPrompt, issues) {
        let transformed = originalPrompt.toLowerCase();

        // Remove age references and replace with product focus
        const ageReplacements = {
            // Age patterns
            /\b\d+[\s-]?(?:year|yr)[\s-]?old\b/gi: '',
            /\byears?\s+old\b/gi: '',
            
            // People to objects
            /\b(?:child|children|kid|kids|boy|girl|baby|babies|infant|toddler)\b/gi: 'product',
            /\b(?:person|people|human|individual|model)\b/gi: 'item',
            
            // Actions to states
            /\b(?:drinking|eating|consuming)\b/gi: 'featuring',
            /\b(?:holding|grasping|clutching)\b/gi: 'displaying',
            
            // Contexts to artistic styles
            /\bphotoshoot\b/gi: 'product photography',
            /\bmodeling\b/gi: 'artistic arrangement',
            /\bpose\b/gi: 'composition'
        };

        for (const [pattern, replacement] of Object.entries(ageReplacements)) {
            transformed = transformed.replace(pattern, replacement);
        }

        // Clean up and make it more abstract
        transformed = transformed
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^/, 'artistic still life composition featuring ')
            .replace(/milk\s*fro/, 'milk glass with frothy texture');

        return {
            original: originalPrompt,
            transformed: transformed,
            method: 'rule_based_transformation',
            issues: issues
        };
    }

    async validatePrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Prompt is required and must be a string');
        }

        if (prompt.length > 1000) {
            throw new Error('Prompt must be less than 1000 characters');
        }

        // Enhanced validation
        const issues = this.detectProblematicContent(prompt);
        const highSeverityIssues = issues.filter(issue => issue.severity === 'high');

        if (highSeverityIssues.length > 0) {
            logger.warn('High severity content policy issues detected:', highSeverityIssues);
            // Don't throw error here, let transformation handle it
        }

        return true;
    }

    async generateImage(prompt, userId, options = {}) {
        try {
            logger.info(`Generating image for user ${userId} with prompt: ${prompt}`);
            
            await this.validatePrompt(prompt);

            // Enhanced strategy with smart transformation
            const strategies = [
                // Strategy 1: Try original prompt first
                async () => ({ 
                    original: prompt, 
                    transformed: prompt, 
                    method: 'original' 
                }),
                
                // Strategy 2: Smart AI transformation
                async () => await this.smartPromptTransformation(prompt),
                
                // Strategy 3: Ultra-safe abstract version
                async () => ({
                    original: prompt,
                    transformed: `abstract artistic composition inspired by the concept of: ${prompt.replace(/\b(?:child|children|kid|kids|boy|girl|baby|babies|infant|toddler|person|people|human)\b/gi, 'element').substring(0, 50)}, digital art style`,
                    method: 'ultra_abstract'
                })
            ];

            let lastError = null;

            for (let i = 0; i < strategies.length; i++) {
                try {
                    const promptResult = await strategies[i]();
                    const finalPrompt = promptResult.transformed;
                    
                    logger.info(`Trying strategy ${i + 1}: ${promptResult.method}`);
                    logger.info(`Using prompt: ${finalPrompt}`);
                    
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
                                    promptWasTransformed: promptResult.original !== promptResult.transformed,
                                    transformationMethod: promptResult.method,
                                    modelUsed: model,
                                    detectedIssues: promptResult.issues || []
                                };
                            }
                        } catch (modelError) {
                            logger.warn(`Model ${model} failed: ${modelError.message}`);
                            lastError = modelError;
                            
                            // If it's a content policy error, try next strategy immediately
                            if (modelError.message.includes('content policy') || 
                                modelError.message.includes('safety') ||
                                modelError.message.includes('blocked') ||
                                modelError.message.includes('58061214')) {
                                break; // Break model loop, try next strategy
                            }
                        }
                    }
                } catch (strategyError) {
                    logger.warn(`Strategy ${i + 1} failed: ${strategyError.message}`);
                    lastError = strategyError;
                }
            }

            // Enhanced error message based on detected issues
            const issues = this.detectProblematicContent(prompt);
            const hasAgeIssues = issues.some(issue => issue.type === 'age_related');
            
            if (hasAgeIssues) {
                throw new Error('Unable to generate images with human subjects, especially minors. Try focusing on objects, landscapes, abstract art, or product photography instead.');
            } else {
                throw new Error('Content policy violation. Please try rephrasing with more abstract, artistic language.');
            }

        } catch (error) {
            logger.error(`Error generating image: ${error.message}`);
            
            if (error.message && error.message.includes('quota')) {
                throw new Error('Rate limit exceeded. Please try again later.');
            }
            
            throw error;
        }
    }

    // IMPROVED: Better response handling
    async generateWithModel(prompt, modelName, options = {}) {
        try {
            await this.testAuth();
            const accessToken = await this.getAccessToken();
            const fetch = require('node-fetch');
            
            const url = `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${modelName}:predict`;
            
            const requestBody = {
                instances: [
                    {
                        prompt: prompt
                    }
                ],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: options.aspectRatio || "1:1",
                    safetyFilterLevel: "block_few",
                    personGeneration: "allow_adult"
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
                
                if (response.status === 400) {
                    if (responseText.includes('content policy') || 
                        responseText.includes('safety') || 
                        responseText.includes('blocked') ||
                        responseText.includes('58061214')) {
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
            
            // Enhanced response validation
            if (result.predictions && result.predictions[0]) {
                const prediction = result.predictions[0];
                
                if (prediction.bytesBase64Encoded && prediction.bytesBase64Encoded.length > 0) {
                    return {
                        base64: prediction.bytesBase64Encoded,
                        mimeType: prediction.mimeType || 'image/png'
                    };
                }
            }

            // Log the actual response structure for debugging
            logger.error(`Unexpected response structure from ${modelName}:`, JSON.stringify(result, null, 2));

            // Check for empty predictions (content policy)
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
