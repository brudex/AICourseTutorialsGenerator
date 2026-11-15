import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: AiGateway barrel, aiGateway, src/lib/ai
 *
 * WHAT:  Public surface of the AI Gateway. Import from '@/lib/ai' — never from
 *        the adapter directly.
 * WHERE: aiProviders router; agents and the worker (planned).
 */

export { generateImage, generateStructured, generateText, readImageText, synthesizeSpeech, testProviderConnection, verifyProviderCredentials } from './gateway'
export type { GenerateStructuredRequest } from './gateway'
export { buildPresetRoutes, hasRouteFor, resolveModelsForCall } from './routing'
export type { PresetRoute } from './routing'
export { encryptApiKey, apiKeyLast4, decryptApiKey } from './crypto'
export { AiGatewayError, isRetryableAiError } from './errors'
export { calculateCostMicros, formatCostMicros } from './cost'
