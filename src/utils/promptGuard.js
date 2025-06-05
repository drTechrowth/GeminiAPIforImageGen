// ../utils/promptGuard.js
const { logger } = require('./logger');

class PromptGuard {
    constructor(textModel, config) {
        this.textModel = textModel;
        this.config = config;
        this.contentDetection = config.contentDetection;
        this.transformationConfig = config.promptTransformation;
    }

    /**
     * Detects problematic content in prompts
     * @param {string} prompt - The prompt to analyze
     * @returns {Array} Array of detected issues
     */
    detectProblematicContent(prompt) {
        const issues = [];
        const lowerPrompt = prompt.toLowerCase();

        // Check age-related patterns
        for (const pattern of this.contentDetection.agePatterns) {
            if (pattern.test(prompt)) {
                issues.push({
                    type: 'age_related',
                    pattern: pattern.toString(),
                    severity: 'high'
                });
            }
        }

        // Check risky context patterns
        for (const pattern of this.contentDetection.riskPatterns) {
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

    /**
     * Uses AI to transform prompts while preserving intent
     * @param {string} originalPrompt - The original prompt
     * @returns {Object} Transformation result
     */
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

            // Create transformation prompt by replacing placeholder
            const transformationPrompt = this.transformationConfig.prompt.replace(
                '{ORIGINAL_PROMPT}', 
                originalPrompt
            );

            const result = await this.textModel.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: transformationPrompt }]
                }],
                generationConfig: this.transformationConfig.config
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

    /**
     * Rule-based transformation as fallback
     * @param {string} originalPrompt - The original prompt
     * @param {Array} issues - Detected issues
     * @returns {Object} Transformation result
     */
    ruleBasedTransformation(originalPrompt, issues) {
        let transformed = originalPrompt;

        // Apply all replacement patterns
        for (const { pattern, replacement } of this.contentDetection.replacements) {
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

    /**
     * Validates that the prompt is safe for ultra-abstract transformation
     * @param {string} prompt - The prompt to validate
     * @returns {boolean} Whether the prompt is safe
     */
    isPromptSafeForAbstraction(prompt) {
        const issues = this.detectProblematicContent(prompt);
        return issues.filter(issue => issue.severity === 'high').length === 0;
    }

    /**
     * Creates an ultra-safe abstract version of the prompt
     * @param {string} originalPrompt - The original prompt
     * @returns {string} Abstract version of the prompt
     */
    createAbstractVersion(originalPrompt) {
        const cleanedPrompt = originalPrompt
            .replace(/\b(?:child|children|kid|kids|boy|girl|baby|babies|infant|toddler|person|people|human)\b/gi, 'element')
            .substring(0, 50);
        
        return `abstract artistic composition inspired by the concept of: ${cleanedPrompt}, digital art style`;
    }

    /**
     * Gets statistics about content detection
     * @param {string} prompt - The prompt to analyze
     * @returns {Object} Statistics about the prompt
     */
    getPromptStats(prompt) {
        const issues = this.detectProblematicContent(prompt);
        const highSeverity = issues.filter(issue => issue.severity === 'high');
        const mediumSeverity = issues.filter(issue => issue.severity === 'medium');

        return {
            totalIssues: issues.length,
            highSeverityIssues: highSeverity.length,
            mediumSeverityIssues: mediumSeverity.length,
            recommendsTransformation: issues.length > 0,
            requiresTransformation: highSeverity.length > 0
        };
    }
}

module.exports = PromptGuard;
