FROM node:18-slim

# Set Node.js to run in production mode
ENV NODE_ENV=production

# Create app directory
WORKDIR /usr/src/app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install app dependencies
COPY package*.json ./

# Use npm install instead of npm ci if package-lock.json doesn't exist
# Added error handling and verbose logging
RUN echo "Installing dependencies..." && \
    if [ -f package-lock.json ]; then \
        echo "Found package-lock.json, using npm ci..." && \
        npm ci --only=production --verbose || exit 1; \
    else \
        echo "No package-lock.json found, using npm install..." && \
        npm install --only=production --verbose || exit 1; \
    fi && \
    echo "Dependencies installed successfully!"

# Bundle app source
COPY . .

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Use a non-root user
USER node

# Start the application with proper error handling
CMD ["node", "src/app.js"]
