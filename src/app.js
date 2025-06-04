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

// Enhanced middleware configuration
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configuration with security headers
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || false
    : true,
  credentials: true,
  optionsSuccessStatus: 200
}));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Basic health check
    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development'
    };

    // Optional: Test Gemini service connection
    if (req.query.deep === 'true') {
      try {
        await geminiService.testAuth();
        healthStatus.services = {
          gemini: 'connected'
        };
      } catch (error) {
        healthStatus.services = {
          gemini: 'disconnected',
          error: error.message
        };
        return res.status(503).json(healthStatus);
      }
    }

    res.status(200).json(healthStatus);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Service unavailable'
    });
  }
});

// API endpoint for image generation
app.post('/api/generate', async (req, res) => {
  const startTime = Date.now();
  let userId = req.ip || 'anonymous';

  try {
    const { prompt, options } = req.body;
    
    // Enhanced input validation
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PROMPT',
          message: 'Prompt is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Validate rate limit and input
    validator.validateRateLimit(userId);
    validator.validateUserInput(prompt);
    
    // Validate optional parameters if provided
    const validatedOptions = validator.validateImageOptions(options);
    
    logger.info(`Starting image generation for user ${userId}`);
    
    // Generate the image (now with AI-powered prompt optimization)
    const imageData = await geminiService.generateImage(prompt, userId);
    
    const processingTime = Date.now() - startTime;
    
    // Return enhanced response with optimization details
    res.status(200).json({
      success: true,
      data: {
        base64: imageData.base64,
        mimeType: imageData.mimeType
      },
      prompt: {
        original: imageData.originalPrompt || prompt,
        used: imageData.promptUsed,
        wasOptimized: imageData.promptWasOptimized || false,
        optimizationMethod: imageData.optimizationMethod || 'none'
      },
      options: validatedOptions,
      metadata: {
        timestamp: new Date().toISOString(),
        userId: userId,
        processingTimeMs: processingTime
      }
    });

    logger.info(`Image generation completed for user ${userId} in ${processingTime}ms`);
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error(`Error generating image for user ${userId}: ${error.message}`);
    
    // Enhanced error response with specific error codes
    let errorCode = 'GENERATION_ERROR';
    let userMessage = error.message;
    let statusCode = 400;
    
    if (error.message.includes('content policy') || error.message.includes('safety')) {
      errorCode = 'CONTENT_POLICY_VIOLATION';
      userMessage = 'Your request could not be processed due to content guidelines. Please try rephrasing your prompt or removing specific brand names.';
    } else if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
      errorCode = 'RATE_LIMIT_EXCEEDED';
      statusCode = 429;
    } else if (error.message.includes('authentication') || error.message.includes('credentials')) {
      errorCode = 'AUTHENTICATION_ERROR';
      userMessage = 'Service temporarily unavailable. Please try again later.';
      statusCode = 503;
    } else if (error.message.includes('quota') || error.message.includes('Quota')) {
      errorCode = 'QUOTA_EXCEEDED';
      userMessage = 'Service quota exceeded. Please try again later.';
      statusCode = 503;
    } else if (error.message.includes('permission') || error.message.includes('Forbidden')) {
      errorCode = 'PERMISSION_ERROR';
      userMessage = 'Service configuration error. Please contact support.';
      statusCode = 503;
    } else if (error.message.includes('Invalid') || error.message.includes('validation')) {
      errorCode = 'VALIDATION_ERROR';
      statusCode = 400;
    }
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: errorCode,
        message: userMessage,
        timestamp: new Date().toISOString(),
        processingTimeMs: processingTime
      }
    });
  } finally {
    // Decrement concurrent request count regardless of success/failure
    if (userId && userId !== 'anonymous') {
      try {
        validator.decrementConcurrentRequests(userId);
      } catch (error) {
        logger.warn('Failed to decrement concurrent requests:', error.message);
      }
    }
  }
});

// NEW: Endpoint to test prompt optimization without generating image
app.post('/api/optimize-prompt', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PROMPT',
          message: 'Prompt is required and must be a string',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (prompt.length > 1000) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PROMPT_TOO_LONG',
          message: 'Prompt must be less than 1000 characters',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Use the AI optimization function
    const result = await geminiService.optimizePromptWithAI(prompt);
    
    res.status(200).json({
      success: true,
      data: {
        original: result.original,
        optimized: result.optimized,
        method: result.method,
        wasChanged: result.original !== result.optimized,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error optimizing prompt:', error.message);
    res.status(500).json({
      success: false,
      error: {
        code: 'OPTIMIZATION_ERROR',
        message: 'Failed to optimize prompt. Please try again.',
        timestamp: new Date().toISOString()
      }
    });
  }
});

// NEW: Service status endpoint
app.get('/api/status', async (req, res) => {
  try {
    const status = {
      service: 'AI Image Generation API',
      version: '2.0.0',
      status: 'operational',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      features: {
        aiPromptOptimization: true,
        contentPolicyValidation: true,
        rateLimiting: true,
        brandNameReplacement: true
      }
    };

    // Test Gemini service if requested
    if (req.query.test === 'true') {
      try {
        await geminiService.testAuth();
        status.geminiService = 'connected';
      } catch (error) {
        status.geminiService = 'disconnected';
        status.status = 'degraded';
        status.issues = ['Gemini service connection failed'];
      }
    }

    res.status(200).json(status);
  } catch (error) {
    logger.error('Status check failed:', error);
    res.status(500).json({
      service: 'AI Image Generation API',
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Status check failed'
    });
  }
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.status(200).json({
    title: 'AI-Powered Image Generation API',
    description: 'Generate high-quality images from text prompts with intelligent optimization',
    version: '2.0.0',
    baseUrl: req.protocol + '://' + req.get('host'),
    endpoints: [
      {
        path: '/api/generate',
        method: 'POST',
        description: 'Generate an image based on a text prompt with AI-powered optimization',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            maxLength: 1000,
            description: 'Text description of the image to generate'
          },
          options: {
            type: 'object',
            required: false,
            description: 'Additional generation options (future use)'
          }
        },
        responses: {
          200: 'Success - Returns base64 encoded image with metadata',
          400: 'Bad Request - Invalid input or content policy violation',
          429: 'Too Many Requests - Rate limit exceeded',
          503: 'Service Unavailable - Authentication or quota issues'
        },
        example: {
          request: {
            prompt: 'African family with nutritional milk product in modern kitchen'
          },
          response: {
            success: true,
            data: {
              base64: 'base64_encoded_image_data',
              mimeType: 'image/png'
            },
            prompt: {
              original: 'African family with nutritional milk product in modern kitchen',
              used: 'Professional photograph of family of African descent with nutritional milk product in contemporary kitchen setting, natural lighting, high quality composition',
              wasOptimized: true,
              optimizationMethod: 'ai_powered'
            },
            metadata: {
              timestamp: '2025-06-04T07:40:08.469Z',
              userId: '127.0.0.1',
              processingTimeMs: 3500
            }
          }
        }
      },
      {
        path: '/api/optimize-prompt',
        method: 'POST',
        description: 'Test prompt optimization without generating an image',
        parameters: {
          prompt: {
            type: 'string',
            required: true,
            maxLength: 1000,
            description: 'Text prompt to optimize'
          }
        },
        responses: {
          200: 'Success - Returns optimized prompt',
          400: 'Bad Request - Invalid prompt',
          500: 'Internal Server Error - Optimization failed'
        },
        example: {
          request: {
            prompt: 'Kids drinking Coca Cola at party'
          },
          response: {
            success: true,
            data: {
              original: 'Kids drinking Coca Cola at party',
              optimized: 'Children enjoying cola beverages at celebration gathering, natural lighting, joyful atmosphere, professional photography style',
              method: 'ai_powered',
              wasChanged: true,
              timestamp: '2025-06-04T07:40:08.469Z'
            }
          }
        }
      },
      {
        path: '/api/status',
        method: 'GET',
        description: 'Get service status and health information',
        parameters: {
          test: {
            type: 'boolean',
            required: false,
            description: 'Include Gemini service connectivity test'
          }
        },
        responses: {
          200: 'Service status information'
        }
      },
      {
        path: '/health',
        method: 'GET',
        description: 'Basic health check endpoint',
        parameters: {
          deep: {
            type: 'boolean',
            required: false,
            description: 'Perform deep health check including service connections'
          }
        },
        responses: {
          200: 'Service is healthy',
          503: 'Service is unhealthy'
        }
      }
    ],
    features: [
      'AI-powered prompt optimization using Gemini Pro',
      'Automatic brand name replacement',
      'Content policy violation prevention',
      'Professional photography enhancement',
      'Fallback optimization methods',
      'Rate limiting and abuse prevention',
      'Detailed response metadata',
      'Comprehensive error handling'
    ],
    rateLimits: {
      perUser: '10 requests per minute',
      concurrent: '3 simultaneous requests per user'
    },
    contentPolicy: {
      prohibited: [
        'Explicit or adult content',
        'Violence or gore',
        'Hate speech or discrimination',
        'Copyrighted brand logos'
      ],
      recommendations: [
        'Use descriptive, family-friendly language',
        'Replace brand names with generic terms',
        'Include professional photography context',
        'Be specific about composition and lighting'
      ]
    }
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ENDPOINT_NOT_FOUND',
      message: `API endpoint ${req.method} ${req.path} not found`,
      timestamp: new Date().toISOString(),
      availableEndpoints: [
        'GET /api/docs',
        'GET /api/status',
        'POST /api/generate',
        'POST /api/optimize-prompt',
        'GET /health'
      ]
    }
  });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Don't expose error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { details: err.message })
    }
  });
});

// Graceful shutdown handling
const server = app.listen(process.env.PORT || 3000, () => {
  const port = process.env.PORT || 3000;
  logger.info(`🚀 AI Image Generation API server running on port ${port}`);
  logger.info(`📖 API Documentation available at http://localhost:${port}/api/docs`);
  logger.info(`💚 Health check available at http://localhost:${port}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;
