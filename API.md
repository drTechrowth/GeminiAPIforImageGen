# API Documentation

## Overview

This API allows you to generate images from text descriptions using Google's Gemini AI model. The service provides both a web interface and a REST API for programmatic access.

## Base URL

When deployed on Render, your base URL will be provided by Render. For local development, the base URL is:

```
http://localhost:3000
```

## Authentication

Currently, the API uses IP-based rate limiting without requiring authentication. Future versions may implement API key authentication.

## Endpoints

### Generate Image

Generates an image based on a text description.

**URL**: `/api/generate`

**Method**: `POST`

**Content Type**: `application/json`

**Request Body**:

| Field | Type | Description |
|-------|------|-------------|
| prompt | string | Text description of the image to generate (required, max 1000 characters) |

**Example Request**:

```json
{
  "prompt": "A serene mountain landscape at sunset with a lake reflecting the sky"
}
```

**Success Response**:

- **Code**: 200 OK
- **Content**:

```json
{
  "success": true,
  "data": {
    "url": "https://example.com/image.jpg",
    "base64": "base64_encoded_image_data"
  },
  "prompt": "A serene mountain landscape at sunset with a lake reflecting the sky"
}
```

**Error Response**:

- **Code**: 400 Bad Request
- **Content**:

```json
{
  "success": false,
  "error": "Error message describing the issue"
}
```

Possible error messages:
- "Invalid input: Must provide a text description"
- "Input too short: Please provide a more detailed description"
- "Input too long: Must be under 1000 characters"
- "Rate limit exceeded. Please try again in X minutes."
- "Invalid prompt: Contains prohibited content"

### Health Check

Check if the service is running properly.

**URL**: `/health`

**Method**: `GET`

**Success Response**:

- **Code**: 200 OK
- **Content**:

```json
{
  "status": "ok"
}
```

### API Documentation

Get API documentation in JSON format.

**URL**: `/api/docs`

**Method**: `GET`

**Success Response**:

- **Code**: 200 OK
- **Content**: JSON object containing API documentation

## Rate Limiting

The API implements rate limiting to prevent abuse:

- Default: 21 requests per hour per IP address
- This can be configured via the `MAX_REQUESTS_PER_USER_PER_HOUR` environment variable

## Error Handling

All errors are returned with appropriate HTTP status codes and JSON responses containing error details.

## Examples

### cURL

```bash
curl -X POST \
  http://localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "A serene mountain landscape at sunset with a lake reflecting the sky"}'
```

### JavaScript

```javascript
fetch('http://localhost:3000/api/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: 'A serene mountain landscape at sunset with a lake reflecting the sky'
  })
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

### Python

```python
import requests

response = requests.post(
    'http://localhost:3000/api/generate',
    json={'prompt': 'A serene mountain landscape at sunset with a lake reflecting the sky'}
)

data = response.json()
print(data)
```
