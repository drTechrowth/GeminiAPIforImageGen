# Image Generation Web Service

A standalone web service that generates images using Google's Gemini API. Built with Node.js and optimized for Render deployment.

## Overview

This project provides both a web interface and REST API for generating images from text descriptions. It leverages Google's Gemini AI model to create high-quality images based on user prompts.

## Features

- **Simple Web Interface**: Easy-to-use form for entering image descriptions
- **REST API**: Programmatic access for integration with other applications
- **Input Validation**: Ensures prompts meet requirements and filters prohibited content
- **Rate Limiting**: Prevents abuse with configurable request limits
- **Error Handling**: Clear, user-friendly error messages
- **Optional Parameters**: Support for image format selection

## Setup

### Prerequisites

- Node.js 18 or higher
- Google Cloud account with Gemini API access
- Render account for hosting (or any other hosting platform)

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/image-generation-service.git
   cd image-generation-service
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your Google Cloud credentials:
   ```
   # Google Cloud Configuration
   GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account","project_id":"your-project-id",...}
   GOOGLE_CLOUD_PROJECT_ID=your-project-id
   GOOGLE_CLOUD_REGION=us-central1
   
   # App Configuration
   PORT=3000
   NODE_ENV=development
   LOG_LEVEL=info
   
   # Rate Limiting
   MAX_REQUESTS_PER_USER_PER_HOUR=21
   MAX_CONCURRENT_GENERATIONS=3
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Access the web interface at http://localhost:3000

### Deployment to Render

This project is optimized for deployment on Render's free tier:

1. Create a new Web Service on Render
2. Connect your GitHub repository
3. Use the following settings:
   - **Name**: image-generation-service (or your preferred name)
   - **Environment**: Node
   - **Build Command**: `npm ci`
   - **Start Command**: `npm start`
   - **Plan**: Free (or your preferred plan)

4. Add the following environment variables:
   - `NODE_ENV`: production
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON`: Your Google Cloud service account credentials JSON (as a single line)
   - `GOOGLE_CLOUD_PROJECT_ID`: Your Google Cloud project ID
   - `GOOGLE_CLOUD_REGION`: Your preferred region (e.g., us-central1)
   - `MAX_REQUESTS_PER_USER_PER_HOUR`: 21 (or your preferred limit)
   - `MAX_CONCURRENT_GENERATIONS`: 3 (or your preferred limit)

5. Deploy the service

## API Usage

The service provides a REST API for programmatic access. See [API.md](API.md) for complete documentation.

### Quick Example

```javascript
// Generate an image
fetch('https://your-render-url.onrender.com/api/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: 'A serene mountain landscape at sunset with a lake reflecting the sky',
    options: {
      format: 'jpeg' // Optional: 'jpeg' or 'png'
    }
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

## Web Interface

The web interface is accessible at the root URL of your deployment. It provides a simple form for entering image descriptions and viewing the generated images.

## Rate Limiting

To prevent abuse, the service implements rate limiting:
- Default: 21 requests per hour per IP address
- Maximum 3 concurrent generations per IP address

These limits can be configured via environment variables.

## License

ISC

## Created

2025-06-03
