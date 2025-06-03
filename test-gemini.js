const { logger } = require('../utils/logger');

const setupSlackMentions = (app) => {
    app.message(/help/i, async ({ message, say }) => {
        try {
            if (message.thread_ts) {
                await say({
                    text: 'Use `/image-help` for instructions on how to use the Image Generation Bot.',
                    thread_ts: message.thread_ts
                });
            } else {
                await say({
                    text: 'Use `/image-help` for instructions on how to use the Image Generation Bot.'
                });
            }
        } catch (error) {
            logger.error(`Error handling help message: ${error.message}`);
        }
    });

    // Handle direct messages
    app.message(/.*/, async ({ message, say }) => {
        try {
            // Only respond to direct messages, not channel messages
            if (message.channel_type === 'im') {
                await say({
                    text: 'Hello! Please use `/generate-image` in a channel to create images, or `/image-help` for assistance.'
                });
            }
        } catch (error) {
            logger.error(`Error handling direct message: ${error.message}`);
        }
    });
};

module.exports = { setupSlackMentions };
