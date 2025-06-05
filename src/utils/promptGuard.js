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
     * Detects problematic content in prompts - now more permissive
     * @param {string} prompt - The prompt to analyze
     * @returns {Array} Array of detected issues
     */
    detectProblematicContent(prompt) {
        const issues = [];
        const lowerPrompt = prompt.toLowerCase();

        // Only flag truly problematic content, not general age mentions
        const highRiskPatterns = [
            /\b(?:naked|nude|undressed|sexual|inappropriate)\b.*\b(?:child|children|kid|kids|minor)\b/i,
            /\b(?:child|children|kid|kids|minor)\b.*\b(?:naked|nude|undressed|sexual|inappropriate)\b/i
        ];

        for (const pattern of highRiskPatterns) {
            if (pattern.test(prompt)) {
                issues.push({
                    type: 'high_risk_content',
                    pattern: pattern.toString(),
                    severity: 'high'
                });
            }
        }

        return issues;
    }

    /**
     * Enhanced prompt transformation that preserves cultural context
     * @param {string} originalPrompt - The original prompt
     * @returns {Object} Transformation result
     */
    async smartPromptTransformation(originalPrompt) {
        try {
            const issues = this.detectProblematicContent(originalPrompt);
            
            if (issues.length === 0) {
                return {
                    original: originalPrompt,
                    transformed: this.enhancePromptQuality(originalPrompt),
                    method: 'quality_enhancement',
                    issues: []
                };
            }

            logger.info(`Detected ${issues.length} high-risk issues:`, issues);

            // Only transform if truly problematic
            if (issues.some(issue => issue.severity === 'high')) {
                const transformationPrompt = this.transformationConfig.enhancedPrompt.replace(
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
                        method: 'ai_safety_transformation',
                        issues: issues
                    };
                }
            }

            return {
                original: originalPrompt,
                transformed: this.enhancePromptQuality(originalPrompt),
                method: 'quality_enhancement',
                issues: issues
            };

        } catch (error) {
            logger.error('AI transformation failed:', error.message);
            return {
                original: originalPrompt,
                transformed: this.enhancePromptQuality(originalPrompt),
                method: 'quality_enhancement_fallback',
                issues: this.detectProblematicContent(originalPrompt)
            };
        }
    }

    /**
     * Enhances prompt quality without removing cultural context
     * @param {string} prompt - The original prompt
     * @returns {string} Enhanced prompt
     */
    enhancePromptQuality(prompt) {
        // Add quality and context enhancers while preserving the original intent
        const qualityEnhancers = [
            'high quality photograph',
            'natural lighting',
            'authentic cultural representation',
            'dignified portrayal',
            'respectful documentation',
            'human warmth and connection'
        ];

        const randomEnhancers = qualityEnhancers
            .sort(() => 0.5 - Math.random())
            .slice(0, 3)
            .join(', ');

        return `${randomEnhancers}, ${prompt}, photorealistic, professional photography, meaningful moment`;
    }

    /**
     * Rule-based transformation - now more conservative
     * @param {string} originalPrompt - The original prompt
     * @param {Array} issues - Detected issues
     * @returns {Object} Transformation result
     */
    ruleBasedTransformation(originalPrompt, issues) {
        let transformed = originalPrompt;

        // Only apply transformations for truly problematic content
        if (issues.some(issue => issue.severity === 'high')) {
            // Apply minimal necessary changes
            transformed = transformed
                .replace(/\b(?:naked|nude|undressed)\b/gi, 'clothed')
                .replace(/\b(?:sexual|inappropriate)\b/gi, 'appropriate');
        }

        // Always enhance quality
        transformed = this.enhancePromptQuality(transformed);

        return {
            original: originalPrompt,
            transformed: transformed,
            method: 'conservative_rule_based',
            issues: issues
        };
    }

    /**
     * More permissive validation for abstraction
     * @param {string} prompt - The prompt to validate
     * @returns {boolean} Whether the prompt is safe
     */
    isPromptSafeForAbstraction(prompt) {
        const issues = this.detectProblematicContent(prompt);
        return issues.filter(issue => issue.severity === 'high').length === 0;
    }

    /**
     * Creates culturally sensitive enhanced version
     * @param {string} originalPrompt - The original prompt
     * @returns {string} Enhanced version of the prompt
     */
    createCulturallyEnhancedVersion(originalPrompt) {
        return `Cultural portrait photography: ${originalPrompt}, authentic setting, natural environment, respectful documentation, human dignity, photojournalistic style, warm natural lighting, genuine moment`;
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
            recommendsTransformation: highSeverity.length > 0,
            requiresTransformation: highSeverity.length > 0,
            isCulturallyAcceptable: highSeverity.length === 0
        };
    }

    /**
     * Determines if prompt needs cultural sensitivity enhancement
     * @param {string} prompt - The prompt to analyze
     * @returns {boolean} Whether enhancement is recommended
     */
    needsCulturalEnhancement(prompt) {
        const culturalKeywords = [
            'african', 'asian', 'hispanic', 'native', 'indigenous', 'traditional',
            'cultural', 'ethnic', 'community', 'family', 'child', 'children'
        ];

        return culturalKeywords.some(keyword => 
            prompt.toLowerCase().includes(keyword)
        );
    }
}

module.exports = PromptGuard;
