"use client";

import { AI_CAPABILITIES, type AiCapability } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import {
  MODEL_ID_PATTERN,
  createModelSchema,
  discoverResponseSchema,
  modelViewSchema,
  updateModelSchema,
  type DiscoveredModelView,
  type ModelView,
  type ProviderView,
  type UpdateModelInput,
} from "@wasfa/shared/schemas/admin-ai";
import { Button, Checkbox, Field, Input, Select, Spinner, useToast } from "@wasfa/ui";
import { RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  bpToMultiplierText,
  formatMultiplier,
  multiplierToBp,
  parseUsd,
  usdInputText,
} from "../../lib/ai-admin";
import { api } from "../../lib/api-client";
import { errorReason, fieldPaths, type ApiRequestError } from "../../lib/api-error";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice, errorMessage } from "../error-notice";

import { Code } from "./badges";

import type { FormEvent } from "react";

type FieldName =
  | "providerId"
  | "modelId"
  | "displayName"
  | "contextTokens"
  | "priceInput"
  | "priceCached"
  | "priceOutput"
  | "priceSearch"
  | "multiplier";
type Errors = Partial<Record<FieldName, string>>;

/** The API's field names, mapped onto the form's. */
const API_FIELDS: Record<string, FieldName> = {
  providerId: "providerId",
  modelId: "modelId",
  displayName: "displayName",
  contextTokens: "contextTokens",
  priceInputUsdMicrosPerM: "priceInput",
  priceCachedInputUsdMicrosPerM: "priceCached",
  priceOutputUsdMicrosPerM: "priceOutput",
  priceSearchUsdMicros: "priceSearch",
  creditMultiplierBp: "multiplier",
};

type Discovery =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: DiscoveredModelView[] }
  | { status: "error" };

/**
 * The provider's own model list (`GET .../discover`), loaded when a provider is chosen. It is only a
 * convenience: a failure leaves the manual input fully working. `refresh` bypasses the server cache.
 */
function useDiscovery(providerId: string): { discovery: Discovery; refresh: () => void } {
  const [state, setState] = useState<{ providerId: string; value: Discovery } | null>(null);
  const [tick, setTick] = useState(0);
  const force = useRef(false);

  useEffect(() => {
    if (providerId === "") return;
    const refreshing = force.current;
    force.current = false;
    const controller = new AbortController();
    setState({ providerId, value: { status: "loading" } });
    api(`/admin/ai/providers/${providerId}/discover${refreshing ? "?refresh=1" : ""}`, {
      schema: discoverResponseSchema,
      signal: controller.signal,
    }).then(
      (response) => {
        setState({ providerId, value: { status: "ready", items: response.items } });
      },
      () => {
        if (controller.signal.aborted) return;
        setState({ providerId, value: { status: "error" } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [providerId, tick]);

  const discovery: Discovery =
    providerId === ""
      ? { status: "idle" }
      : state?.providerId === providerId
        ? state.value
        : { status: "loading" };
  return {
    discovery,
    refresh: () => {
      force.current = true;
      setTick((current) => current + 1);
    },
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

export interface ModelFormProps {
  /** `null` adds a model; a model opens it for editing (its provider and id are fixed). */
  model: ModelView | null;
  providers: readonly ProviderView[];
  /** The provider chosen in the page filter, selected by default when adding. */
  defaultProviderId: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Add or edit one model. Adding has a picker: choosing a provider loads its model list into a
 * `<datalist>`, and picking an entry pre-fills the name, context size, capabilities and prices; typing
 * any other id by hand always works. Prices are typed as USD per 1M tokens and converted exactly.
 */
export function ModelForm({
  model,
  providers,
  defaultProviderId,
  onClose,
  onSaved,
}: ModelFormProps) {
  const reauth = useReauth();
  const { toast } = useToast();
  const creating = model === null;
  const listId = useId();

  const [providerId, setProviderId] = useState(defaultProviderId);
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState(model?.displayName ?? "");
  const [contextTokens, setContextTokens] = useState(
    model?.contextTokens == null ? "" : String(model.contextTokens),
  );
  const [capabilities, setCapabilities] = useState<AiCapability[]>(model?.capabilities ?? []);
  const [priceInput, setPriceInput] = useState(
    model ? usdInputText(model.priceInputUsdMicrosPerM) : "",
  );
  const [priceCached, setPriceCached] = useState(
    model ? usdInputText(model.priceCachedInputUsdMicrosPerM) : "",
  );
  const [priceOutput, setPriceOutput] = useState(
    model ? usdInputText(model.priceOutputUsdMicrosPerM) : "",
  );
  const [priceSearch, setPriceSearch] = useState(
    model && model.priceSearchUsdMicros > 0 ? usdInputText(model.priceSearchUsdMicros) : "",
  );
  const [multiplier, setMultiplier] = useState(
    model ? bpToMultiplierText(model.creditMultiplierBp) : "1",
  );
  const [enabled, setEnabled] = useState(model?.enabled ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const { discovery, refresh } = useDiscovery(creating ? providerId : "");
  const items = discovery.status === "ready" ? discovery.items : [];
  const typed = items.find((item) => item.id === modelId.trim());

  const clearError = (name: FieldName) => {
    setErrors((current) => {
      if (!Object.hasOwn(current, name)) return current;
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== name));
    });
  };

  const applyDiscovered = (item: DiscoveredModelView) => {
    if (item.displayName) setDisplayName(item.displayName);
    if (item.contextTokens !== null) setContextTokens(String(item.contextTokens));
    setCapabilities([...item.capabilities]);
    if (item.pricing) {
      const { pricing } = item;
      const text = (micros: number | null) =>
        micros !== null && Number.isSafeInteger(micros) && micros >= 0 ? usdInputText(micros) : "";
      setPriceInput(text(pricing.inputUsdMicrosPerM));
      setPriceCached(text(pricing.cachedInputUsdMicrosPerM));
      setPriceOutput(text(pricing.outputUsdMicrosPerM));
      setPriceSearch(text(pricing.searchUsdMicros));
    }
    setErrors({});
  };

  const changeModelId = (value: string) => {
    setModelId(value);
    clearError("modelId");
    const hit = items.find((item) => item.id === value.trim());
    if (hit) applyDiscovered(hit);
  };

  const toggleCapability = (capability: AiCapability, on: boolean) => {
    setCapabilities((current) =>
      on
        ? AI_CAPABILITIES.filter((item) => item === capability || current.includes(item))
        : current.filter((item) => item !== capability),
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const next: Errors = {};
    if (creating && providerId === "") next.providerId = t("form.required");
    const id = modelId.trim();
    if (creating) {
      if (id === "") next.modelId = t("form.required");
      else if (!MODEL_ID_PATTERN.test(id)) next.modelId = t("admin.ai.models.error.modelId");
    }
    const name = displayName.trim();
    if (name === "") next.displayName = t("form.required");
    else if (name.length > 120) next.displayName = t("form.tooLong", { max: 120 });

    let context: number | null = null;
    if (contextTokens.trim() !== "") {
      const value = /^\d{1,9}$/.test(contextTokens.trim()) ? Number(contextTokens) : Number.NaN;
      if (value >= 1 && value <= 100_000_000) context = value;
      else next.contextTokens = t("admin.ai.models.error.contextTokens");
    }

    const price = (text: string, optional: boolean, field: FieldName): number | null => {
      const parsed = parseUsd(text, optional);
      if (parsed.ok) return parsed.value;
      next[field] = t(parsed.reason === "required" ? "form.required" : "admin.ai.error.usd");
      return null;
    };
    const input = price(priceInput, false, "priceInput");
    const cached = price(priceCached, true, "priceCached");
    const output = price(priceOutput, false, "priceOutput");
    const search = price(priceSearch, true, "priceSearch");

    const bp = multiplierToBp(multiplier);
    if (bp === null) {
      next.multiplier = t(
        multiplier.trim() === "" ? "form.required" : "admin.ai.models.error.multiplier",
      );
    }

    if (Object.keys(next).length > 0 || input === null || output === null || bp === null) {
      setErrors(next);
      setFormError(null);
      setSubmitCount((count) => count + 1);
      return;
    }

    let request: { path: string; method: "POST" | "PATCH"; body: unknown };
    if (creating) {
      const body = {
        providerId,
        modelId: id,
        displayName: name,
        capabilities,
        contextTokens: context,
        priceInputUsdMicrosPerM: input,
        priceCachedInputUsdMicrosPerM: cached,
        priceOutputUsdMicrosPerM: output,
        priceSearchUsdMicros: search,
        creditMultiplierBp: bp,
        enabled,
      };
      const parsed = createModelSchema.safeParse(body);
      if (!parsed.success) {
        setErrors({ modelId: t("form.invalid") });
        setSubmitCount((count) => count + 1);
        return;
      }
      request = { path: "/admin/ai/models", method: "POST", body: parsed.data };
    } else {
      // Only what changed is sent: a price in the body counts as re-checked, so an untouched price
      // must not be stamped again just because the name was edited.
      const patch: UpdateModelInput = {};
      if (name !== model.displayName) patch.displayName = name;
      if (!sameSet(capabilities, model.capabilities)) patch.capabilities = capabilities;
      if (context !== model.contextTokens) patch.contextTokens = context;
      if (input !== model.priceInputUsdMicrosPerM) patch.priceInputUsdMicrosPerM = input;
      if (cached !== model.priceCachedInputUsdMicrosPerM) {
        patch.priceCachedInputUsdMicrosPerM = cached;
      }
      if (output !== model.priceOutputUsdMicrosPerM) patch.priceOutputUsdMicrosPerM = output;
      if ((search ?? 0) !== model.priceSearchUsdMicros) patch.priceSearchUsdMicros = search;
      if (bp !== model.creditMultiplierBp) patch.creditMultiplierBp = bp;
      if (enabled !== model.enabled) patch.enabled = enabled;
      if (Object.keys(patch).length === 0) {
        toast({ tone: "info", title: t("admin.ai.models.unchanged") });
        onClose();
        return;
      }
      const parsed = updateModelSchema.safeParse(patch);
      if (!parsed.success) {
        setErrors({ displayName: t("form.invalid") });
        setSubmitCount((count) => count + 1);
        return;
      }
      request = { path: `/admin/ai/models/${model.id}`, method: "PATCH", body: parsed.data };
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);
    reauth
      .run(() =>
        api(request.path, { method: request.method, body: request.body, schema: modelViewSchema }),
      )
      .then(
        (saved) => {
          toast({
            tone: "success",
            title: t(creating ? "admin.ai.models.created" : "admin.ai.models.saved", {
              name: saved.displayName,
            }),
          });
          onSaved();
          onClose();
        },
        (error: unknown) => {
          setSubmitting(false);
          const mapped = fieldPaths(error).flatMap((path) => API_FIELDS[path] ?? []);
          if (mapped.length > 0) {
            setErrors(Object.fromEntries(mapped.map((field) => [field, t("form.invalid")])));
            setSubmitCount((count) => count + 1);
          } else if (errorReason(error) === "model_exists") {
            setErrors({ modelId: errorMessage(error) });
            setSubmitCount((count) => count + 1);
          } else {
            setFormError(toApiError(error));
          }
        },
      );
  };

  const priceField = (
    name: FieldName,
    label: string,
    value: string,
    set: (next: string) => void,
    required: boolean,
  ) => (
    <Field label={label} required={required} error={errors[name]} announceError={submitCount > 0}>
      {(control) => (
        <Input
          {...control}
          name={name}
          ltr
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            set(event.target.value);
            clearError(name);
          }}
        />
      )}
    </Field>
  );

  const multiplierPreview = multiplierToBp(multiplier);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {creating ? (
        <>
          <Field
            label={t("admin.ai.models.field.provider")}
            required
            error={errors.providerId}
            announceError={submitCount > 0}
          >
            {(control) => (
              <Select
                {...control}
                name="providerId"
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  clearError("providerId");
                }}
              >
                <option value="">{t("admin.ai.models.field.providerChoose")}</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.key}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex flex-col gap-2">
            <Field
              label={t("admin.ai.models.field.modelId")}
              hint={t("admin.ai.models.field.modelIdHint")}
              required
              error={errors.modelId}
              announceError={submitCount > 0}
            >
              {(control) => (
                <Input
                  {...control}
                  name="modelId"
                  list={listId}
                  ltr
                  autoComplete="off"
                  spellCheck={false}
                  value={modelId}
                  onChange={(event) => {
                    changeModelId(event.target.value);
                  }}
                />
              )}
            </Field>
            <datalist id={listId}>
              {items.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  label={[
                    item.displayName,
                    item.alreadyAdded ? t("admin.ai.models.discover.added") : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {item.alreadyAdded
                    ? t("admin.ai.models.discover.added")
                    : (item.displayName ?? "")}
                </option>
              ))}
            </datalist>
            {typed?.alreadyAdded ? (
              <p className="text-sm text-warning">{t("admin.ai.models.discover.alreadyAdded")}</p>
            ) : null}
            {providerId !== "" ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  name="refresh-models"
                  disabled={discovery.status === "loading"}
                  onClick={refresh}
                >
                  <RefreshCw aria-hidden className="size-5" />
                  {t("admin.ai.models.discover.refresh")}
                </Button>
                {discovery.status === "loading" ? (
                  <span className="inline-flex items-center gap-2 text-sm text-text-muted">
                    <Spinner decorative />
                    {t("admin.ai.models.discover.loading")}
                  </span>
                ) : null}
                {discovery.status === "ready" ? (
                  <span className="text-sm text-text-muted tabular-nums">
                    {t("admin.ai.models.discover.ready", { count: discovery.items.length })}
                  </span>
                ) : null}
                {discovery.status === "error" ? (
                  <span role="alert" className="text-sm text-danger">
                    {t("admin.ai.models.discover.failed")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-md bg-neutral-50 p-4">
          <p className="text-sm text-text-muted">{t("admin.ai.models.field.provider")}</p>
          <Code>{model.provider.key}</Code>
          <p className="mt-2 text-sm text-text-muted">{t("admin.ai.models.field.modelId")}</p>
          <Code>{model.modelId}</Code>
        </div>
      )}

      <Field
        label={t("admin.ai.models.field.displayName")}
        required
        error={errors.displayName}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="displayName"
            autoComplete="off"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              clearError("displayName");
            }}
          />
        )}
      </Field>

      <Field
        label={t("admin.ai.models.field.contextTokens")}
        error={errors.contextTokens}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="contextTokens"
            ltr
            inputMode="numeric"
            autoComplete="off"
            value={contextTokens}
            onChange={(event) => {
              setContextTokens(event.target.value);
              clearError("contextTokens");
            }}
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-base font-semibold text-text">
          {t("admin.ai.models.field.capabilities")}
        </legend>
        <div className="flex flex-wrap gap-x-6">
          {AI_CAPABILITIES.map((capability) => (
            <Checkbox
              key={capability}
              name={`capability.${capability}`}
              label={t(`admin.ai.cap.${capability}`)}
              checked={capabilities.includes(capability)}
              onChange={(event) => {
                toggleCapability(capability, event.target.checked);
              }}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">{t("admin.ai.usdHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {priceField(
            "priceInput",
            t("admin.ai.models.field.priceInput"),
            priceInput,
            setPriceInput,
            true,
          )}
          {priceField(
            "priceOutput",
            t("admin.ai.models.field.priceOutput"),
            priceOutput,
            setPriceOutput,
            true,
          )}
          {priceField(
            "priceCached",
            t("admin.ai.models.field.priceCached"),
            priceCached,
            setPriceCached,
            false,
          )}
          {priceField(
            "priceSearch",
            t("admin.ai.models.field.priceSearch"),
            priceSearch,
            setPriceSearch,
            false,
          )}
        </div>
      </div>

      <Field
        label={t("admin.ai.models.field.multiplier")}
        hint={
          multiplierPreview === null
            ? undefined
            : t("admin.ai.models.field.multiplierHint", {
                value: formatMultiplier(multiplierPreview),
              })
        }
        required
        error={errors.multiplier}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="multiplier"
            ltr
            inputMode="decimal"
            autoComplete="off"
            value={multiplier}
            onChange={(event) => {
              setMultiplier(event.target.value);
              clearError("multiplier");
            }}
          />
        )}
      </Field>

      <Checkbox
        name="enabled"
        label={t("admin.ai.models.field.enabled")}
        checked={enabled}
        onChange={(event) => {
          setEnabled(event.target.checked);
        }}
      />

      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save" loading={submitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
