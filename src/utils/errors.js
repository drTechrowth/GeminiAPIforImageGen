class ApplicationError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends ApplicationError {
    constructor(message) {
        super(message, 400);
        this.name = 'ValidationError';
    }
}

class RateLimitError extends ApplicationError {
    constructor(message) {
        super(message, 429);
        this.name = 'RateLimitError';
    }
}

class AuthenticationError extends ApplicationError {
    constructor(message) {
        super(message, 401);
        this.name = 'AuthenticationError';
    }
}

class ConfigurationError extends ApplicationError {
    constructor(message) {
        super(message, 500);
        this.name = 'ConfigurationError';
    }
}

module.exports = {
    ApplicationError,
    ValidationError,
    RateLimitError,
    AuthenticationError,
    ConfigurationError,
};
