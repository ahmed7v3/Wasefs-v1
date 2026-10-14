import { Inject, Injectable } from "@nestjs/common";
import { AiProviderError, createAdapter, type AIProviderAdapter } from "@wasfa/ai";
import { decryptSecret, encryptSecret, maskSecret } from "@wasfa/shared/crypto";

import { providerKeyContext as keyContext } from "../../ai-runtime/provider-key.js";
import { API_ENV } from "../../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../../config/env.js";

import type { AiProvider } from "@wasfa/db";


/**
 * The only place the admin API turns a provider row into something that can call out, and the only
 * place a provider key is encrypted or decrypted. Tests replace `adapterFor` to script provider
 * answers without a network.
 */
@Injectable()
export class AiGatewayFactory {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** What goes into `api_key_enc` and `key_hint` for a new key. */
  seal(providerKey: string, apiKey: string): { apiKeyEnc: string; keyHint: string } {
    return {
      apiKeyEnc: encryptSecret(apiKey, encryptionKey(this.env), keyContext(providerKey)),
      keyHint: maskSecret(apiKey),
    };
  }

  /**
   * Throws `AiProviderError` only: `auth` when there is no usable key (missing, or it no longer
   * decrypts after an `ENCRYPTION_KEY` change), `bad_request` for a config the adapter refuses.
   */
  adapterFor(provider: AiProvider): AIProviderAdapter {
    let apiKey: string | null = null;
    if (provider.apiKeyEnc !== null) {
      try {
        apiKey = decryptSecret(
          provider.apiKeyEnc,
          encryptionKey(this.env),
          keyContext(provider.key),
        );
      } catch {
        throw new AiProviderError("auth");
      }
    }
    return createAdapter(
      { kind: provider.kind, baseUrl: provider.baseUrl, apiKey, dataPolicy: provider.dataPolicy },
      { env: this.env.NODE_ENV },
    );
  }
}
