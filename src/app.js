const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const { logger } = require('./utils/logger');
const config = require('./utils/config');
const geminiService = require('./services/gemini');
const validator = require('./services/validator');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// API endpoint for image generation
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, options } = req.body;
    const userId = req.ip || 'anonymous'; // Use IP address as user identifier for rate limiting
    
    // Validate rate limit and input
    validator.validateRateLimit(userId);
    validator.validateUserInput(prompt);
    await geminiService.validatePrompt(prompt);
    
    // Validate optional parameters if provided
    const validatedOptions = validator.validateImageOptions(options);
    
    // Generate the image
    const imageData = await geminiService.generateImage(prompt, userId);
    
    // Return the image data
    res.status(200).json({
      success: true,
      data: imageData,
      prompt: prompt,
      options: validatedOptions
    });
  } catch (error) {
    logger.error(`Error generating image: ${error.message}`);
    res.status(400).json({
      success: false,
      error: error.message
    });
  } finally {
    // Decrement concurrent request count regardless of success/failure
    if (req.ip) {
      validator.decrementConcurrentRequests(req.ip);
    }
  }
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.status(200).json({
    description: 'Image Generation API',
    version: '1.0.0',
    endpoints: [
      {
        path: '/api/generate',
        method: 'POST',
        description: 'Generate an image based on a text prompt',
        parameters: {
          prompt: 'Text description of the image to generate (required, string, max 1000 chars)'
        },
        example: {
          request: {
            prompt: 'A serene mountain landscape at sunset with a lake reflecting the sky'
          },
          response: {
            success: true,
            data: {
              url: 'https://example.com/image.jpg',
              base64: 'base64_encoded_image_data'
            },
            prompt: 'A serene mountain landscape at sunset with a lake reflecting the sky'
          }
        }
      },
      {
        path: '/health',
        method: 'GET',
        description: 'Health check endpoint',
        response: {
          status: 'ok'
        }
      }
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false,
    error: 'Internal server error' 
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Image Generation Service is running on port ${PORT}`);
});
