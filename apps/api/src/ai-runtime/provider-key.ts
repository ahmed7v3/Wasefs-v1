/** The key is bound to its provider row (AAD): a ciphertext copied into another provider will not decrypt. */
export const providerKeyContext = (providerKey: string): string => `ai_provider:${providerKey}`;
