// ... (your existing code above) ...

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

            throw new Error('No image data found in response');

        } catch (error) {
            logger.error('Client library generation failed:', error.message);
            throw error;
        }
    }

    async validatePrompt(prompt) {
        if (!prompt || typeof prompt !== 'string') {
            throw new Error('Prompt is required and must be a string');
        }

        if (prompt.length > 1000) {
            throw new Error('Prompt must be less than 1000 characters');
        }

        // Check for potentially harmful content
        const harmfulPatterns = [
            /explicit|nsfw|nude|naked|sex/i,
            /violence|blood|gore|death/i,
            /hate|discrimination|racist/i
        ];

        for (const pattern of harmfulPatterns) {
            if (pattern.test(prompt)) {
                throw new Error('Prompt contains inappropriate content');
            }
        }

        return true;
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
