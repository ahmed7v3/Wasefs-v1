"use client";

import { t } from "@wasfa/shared/i18n";
import {
  voiceKeyStateSchema,
  voiceTestResultSchema,
  WA_AGENT_VOICE_TEST_MAX_CHARS,
  waAgentAdminSettingsSchema,
  type VoiceKeyState,
  type VoiceTestResult,
  type WaAgentAdminSettings,
} from "@wasfa/shared/schemas/admin-wa-agent";
import { planListResponseSchema } from "@wasfa/shared/schemas/plans";
import { waAgentSettingsSchema, type WaAgentSettings } from "@wasfa/shared/settings";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
} from "@wasfa/ui";
import { ImagePlus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";

import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { mediaKeyFrom, microsFromUsdText, usdTextFromMicros } from "../../lib/wa-agent-format";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { ConfirmDialog } from "./confirm-dialog";
import { MediaPickerDialog } from "./media-picker-dialog";
import { ResourceBoundary } from "./resource-boundary";

type Draft = WaAgentSettings;

const range = (min: number, max: number) => t("admin.waAgent.range", { min, max });

/** A whole-number field: the text is the user's own until it parses; `NaN` fails validation on save. */
function NumField({
  name,
  label,
  hint,
  value,
  onChange,
  error,
  disabled,
  min,
  max,
  format = String,
  parse = (text) => (text.trim() === "" ? Number.NaN : Number(text)),
}: {
  name: string;
  label: string;
  hint?: string | undefined;
  value: number;
  onChange: (value: number) => void;
  error?: string | undefined;
  disabled: boolean;
  min?: number;
  max?: number;
  format?: (value: number) => string;
  parse?: (text: string) => number;
}) {
  const [text, setText] = useState(() => format(value));
  const bounds = min !== undefined && max !== undefined ? range(min, max) : undefined;
  return (
    <Field
      label={label}
      hint={[hint, bounds].filter(Boolean).join(" · ") || undefined}
      error={error}
    >
      {(control) => (
        <Input
          {...control}
          name={name}
          inputMode="decimal"
          dir="ltr"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parse(event.target.value));
          }}
        />
      )}
    </Field>
  );
}

/** A 0 to 1 number that may stay empty (the voice's own default then applies). */
function OptionalFraction({
  name,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  name: string;
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  error?: string | undefined;
  disabled: boolean;
}) {
  const [text, setText] = useState(() => (value === undefined ? "" : String(value)));
  return (
    <Field
      label={label}
      hint={[t("admin.waAgent.voice.optionalHint"), range(0, 1)].join(" · ")}
      error={error}
    >
      {(control) => (
        <Input
          {...control}
          name={name}
          inputMode="decimal"
          dir="ltr"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            onChange(event.target.value.trim() === "" ? undefined : Number(event.target.value));
          }}
        />
      )}
    </Field>
  );
}

function Switch({
  name,
  label,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      role="switch"
      name={name}
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.target.checked);
      }}
    />
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <CardTitle>{title}</CardTitle>
        {lead ? <p className="text-sm text-text-muted">{lead}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

/** Plan keys the discount may apply to: the plan list when readable, else a comma separated text. */
function PlanPicker({
  value,
  onChange,
  canReadPlans,
  disabled,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  canReadPlans: boolean;
  disabled: boolean;
}) {
  const plans = useResource(canReadPlans ? "/admin/plans" : null, planListResponseSchema);
  const [text, setText] = useState(() => value.join(", "));

  if (canReadPlans && plans.status === "ready") {
    const known = plans.data.items.filter((plan) => plan.audience !== "organization");
    const knownKeys = new Set(known.map((plan) => plan.key));
    const options = [
      ...known.map((plan) => ({ key: plan.key, label: `${plan.nameAr} (${plan.key})` })),
      ...value.filter((key) => !knownKeys.has(key)).map((key) => ({ key, label: key })),
    ];
    return (
      <fieldset className="flex flex-col gap-1 sm:col-span-2" disabled={disabled}>
        <legend className="text-base font-semibold text-text">
          {t("admin.waAgent.discounts.plans")}
        </legend>
        <p className="text-sm text-text-muted">{t("admin.waAgent.discounts.plansHint")}</p>
        <div className="flex flex-wrap gap-x-6">
          {options.map((option) => (
            <Checkbox
              key={option.key}
              name={`plan-${option.key}`}
              label={option.label}
              checked={value.includes(option.key)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...value, option.key]
                    : value.filter((key) => key !== option.key),
                );
              }}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <Field
      label={t("admin.waAgent.discounts.plans")}
      hint={t("admin.waAgent.discounts.plansTextHint")}
      className="sm:col-span-2"
    >
      {(control) => (
        <Input
          {...control}
          name="discount-plans"
          dir="ltr"
          value={text}
          disabled={disabled}
          onChange={(event) => {
            setText(event.target.value);
            onChange(
              event.target.value
                .split(",")
                .map((key) => key.trim())
                .filter(Boolean),
            );
          }}
        />
      )}
    </Field>
  );
}

function MediaList({
  value,
  onChange,
  disabled,
  errors,
}: {
  value: Draft["media"];
  onChange: (value: Draft["media"]) => void;
  disabled: boolean;
  errors: Record<string, string>;
}) {
  const [picking, setPicking] = useState(false);
  const update = (index: number, patch: Partial<Draft["media"][number]>) => {
    onChange(value.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  };
  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      {value.length === 0 ? (
        <p className="text-sm text-text-muted">{t("admin.waAgent.media.empty")}</p>
      ) : null}
      {value.map((item, index) => (
        <div
          key={item.mediaAssetId}
          className="grid items-start gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-[8rem_1fr_auto]"
        >
          <p className="text-sm text-text-muted">
            <bdi dir="ltr" className="font-mono">
              {item.mediaAssetId.slice(0, 8)}
            </bdi>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("admin.waAgent.media.key")}
              error={errors[`media.${index}.key`]}
              hint={t("admin.waAgent.media.keyHint")}
            >
              {(control) => (
                <Input
                  {...control}
                  name={`media-key-${index}`}
                  dir="ltr"
                  value={item.key}
                  disabled={disabled}
                  onChange={(event) => {
                    update(index, { key: event.target.value });
                  }}
                />
              )}
            </Field>
            <Field
              label={t("admin.waAgent.media.caption")}
              error={errors[`media.${index}.caption`]}
            >
              {(control) => (
                <Input
                  {...control}
                  name={`media-caption-${index}`}
                  value={item.caption ?? ""}
                  disabled={disabled}
                  onChange={(event) => {
                    update(index, { caption: event.target.value });
                  }}
                />
              )}
            </Field>
          </div>
          {disabled ? null : (
            <Button
              type="button"
              variant="ghost"
              name={`media-remove-${index}`}
              aria-label={t("admin.waAgent.media.remove", { key: item.key })}
              onClick={() => {
                onChange(value.filter((_, at) => at !== index));
              }}
            >
              <Trash2 aria-hidden className="size-5" />
            </Button>
          )}
        </div>
      ))}
      {disabled ? null : (
        <div>
          <Button
            type="button"
            variant="secondary"
            name="media-add"
            onClick={() => {
              setPicking(true);
            }}
          >
            <ImagePlus aria-hidden className="size-5" />
            {t("admin.waAgent.media.add")}
          </Button>
        </div>
      )}
      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title={t("admin.waAgent.media.pickerTitle")}
        onSelect={(asset) => {
          if (value.some((item) => item.mediaAssetId === asset.id)) return;
          const key = mediaKeyFrom(
            asset.seoFilename ?? asset.originalFilename,
            new Set(value.map((item) => item.key)),
          );
          onChange([...value, { key, mediaAssetId: asset.id }]);
        }}
      />
    </div>
  );
}

/**
 * The ElevenLabs key. It only ever goes in: the page learns whether one is set and its masked hint,
 * and the input is cleared as soon as the key is saved.
 */
function VoiceKeyCard({
  state,
  canWrite,
  onChanged,
}: {
  state: VoiceKeyState;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const tooShort = apiKey.length > 0 && apiKey.trim().length < 20;

  const save = async () => {
    if (apiKey.trim().length < 20) return;
    setBusy(true);
    setFailure(null);
    try {
      await reauth.run(() =>
        api("/admin/wa-agent/voice-key", {
          method: "PUT",
          body: { apiKey: apiKey.trim() },
          schema: voiceKeyStateSchema,
        }),
      );
      setApiKey("");
      toast({ tone: "success", title: t("admin.waAgent.voiceKey.saved") });
      onChanged();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    await reauth.run(() => api("/admin/wa-agent/voice-key", { method: "DELETE" }));
    toast({ tone: "success", title: t("admin.waAgent.voiceKey.cleared") });
    onChanged();
  };

  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-base font-semibold text-text">
          {t("admin.waAgent.voiceKey.title")}
        </span>
        {state.set ? (
          <Badge tone="success">
            {t("admin.waAgent.voiceKey.set")} •{" "}
            <bdi dir="ltr" className="font-mono">
              {state.hint ?? ""}
            </bdi>
          </Badge>
        ) : (
          <Badge tone="neutral">{t("admin.waAgent.voiceKey.notSet")}</Badge>
        )}
      </div>
      <p className="text-sm text-text-muted">{t("admin.waAgent.voiceKey.hint")}</p>
      {canWrite ? (
        // Not a <form>: this card sits inside the settings form, and forms do not nest.
        <div
          role="group"
          aria-label={t("admin.waAgent.voiceKey.title")}
          className="flex flex-col gap-3"
        >
          <Field
            label={t("admin.waAgent.voiceKey.input")}
            error={tooShort ? t("admin.waAgent.voiceKey.tooShort") : undefined}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                name="elevenlabs-key"
                autoComplete="off"
                dir="ltr"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void save();
                  }
                }}
              />
            )}
          </Field>
          {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
          <div className="flex flex-wrap justify-end gap-3">
            {state.set ? (
              <Button
                type="button"
                variant="danger"
                name="voice-key-clear"
                onClick={() => {
                  setConfirmingClear(true);
                }}
              >
                {t("admin.waAgent.voiceKey.clear")}
              </Button>
            ) : null}
            <Button
              type="button"
              name="voice-key-save"
              loading={busy}
              disabled={apiKey.trim().length < 20}
              onClick={() => {
                void save();
              }}
            >
              {t("admin.waAgent.voiceKey.save")}
            </Button>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmingClear}
        onOpenChange={setConfirmingClear}
        title={t("admin.waAgent.voiceKey.clearTitle")}
        description={t("admin.waAgent.voiceKey.clearBody")}
        confirmLabel={t("admin.waAgent.voiceKey.clearConfirm")}
        tone="danger"
        onConfirm={clear}
      />
    </div>
  );
}

/**
 * "Test voice": speaks a short text with the SAVED settings and plays the returned 60 second link.
 * Not a <form> (it sits inside the settings form).
 */
function VoiceTestBox({ keySet, voiceId }: { keySet: boolean; voiceId: string }) {
  const reauth = useReauth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [clip, setClip] = useState<VoiceTestResult | null>(null);
  const blocked = !keySet
    ? "admin.waAgent.voice.test.noKey"
    : voiceId === ""
      ? "admin.waAgent.voice.test.noVoiceId"
      : null;

  const run = async () => {
    if (text.trim() === "" || blocked !== null) return;
    setBusy(true);
    setFailure(null);
    setClip(null);
    try {
      setClip(
        await reauth.run(() =>
          api("/admin/wa-agent/voice-test", {
            method: "POST",
            body: { text: text.trim() },
            schema: voiceTestResultSchema,
          }),
        ),
      );
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label={t("admin.waAgent.voice.test.title")}
      className="flex flex-col gap-3 sm:col-span-2"
    >
      <span className="text-base font-semibold text-text">
        {t("admin.waAgent.voice.test.title")}
      </span>
      <p className="text-sm text-text-muted">{t("admin.waAgent.voice.test.hint")}</p>
      {blocked === null ? null : <Notice tone="info">{t(blocked)}</Notice>}
      <Field label={t("admin.waAgent.voice.test.text")}>
        {(control) => (
          <Input
            {...control}
            name="voice-test-text"
            maxLength={WA_AGENT_VOICE_TEST_MAX_CHARS}
            value={text}
            disabled={blocked !== null}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void run();
              }
            }}
          />
        )}
      </Field>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {clip ? (
          <audio
            controls
            autoPlay
            src={clip.url}
            aria-label={t("admin.waAgent.voice.test.player")}
            className="max-w-full"
          />
        ) : null}
        <Button
          type="button"
          variant="secondary"
          name="voice-test-run"
          loading={busy}
          disabled={blocked !== null || text.trim() === ""}
          onClick={() => {
            void run();
          }}
        >
          {t("admin.waAgent.voice.test.run")}
        </Button>
      </div>
    </div>
  );
}

/** Field errors by dotted path, from the shared schema (the same one the API enforces). */
export function validateAgentSettings(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  const parsed = waAgentSettingsSchema.safeParse(draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors[issue.path.join(".")] ??= t("admin.waAgent.invalid");
    }
  }
  const seen = new Set<string>();
  draft.media.forEach((item, index) => {
    if (seen.has(item.key)) errors[`media.${index}.key`] = t("admin.waAgent.media.duplicateKey");
    seen.add(item.key);
  });
  return errors;
}

function SettingsForm({
  data,
  canWrite,
  canReadPlans,
  onSaved,
  onKeyChanged,
}: {
  data: WaAgentAdminSettings;
  canWrite: boolean;
  canReadPlans: boolean;
  onSaved: () => void;
  onKeyChanged: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(data.settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const disabled = !canWrite || busy;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setCaps = <K extends keyof Draft["caps"]>(key: K, value: Draft["caps"][K]) => {
    setDraft((current) => ({ ...current, caps: { ...current.caps, [key]: value } }));
  };
  const setDiscounts = <K extends keyof Draft["discounts"]>(
    key: K,
    value: Draft["discounts"][K],
  ) => {
    setDraft((current) => ({ ...current, discounts: { ...current.discounts, [key]: value } }));
  };
  const setVoice = <K extends keyof Draft["voice"]>(key: K, value: Draft["voice"][K]) => {
    setDraft((current) => ({ ...current, voice: { ...current.voice, [key]: value } }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateAgentSettings(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await reauth.run(() =>
        api("/admin/wa-agent/settings", {
          method: "PUT",
          body: draft,
          schema: waAgentAdminSettingsSchema,
        }),
      );
      toast({ tone: "success", title: t("admin.waAgent.saved") });
      onSaved();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const err = (path: string) => errors[path];
  const num = (
    name: string,
    label: string,
    path: string,
    value: number,
    onChange: (value: number) => void,
    min: number,
    max: number,
    hint?: string,
  ) => (
    <NumField
      name={name}
      label={label}
      hint={hint}
      value={value}
      onChange={onChange}
      error={err(path)}
      disabled={disabled}
      min={min}
      max={max}
    />
  );

  return (
    <form
      aria-label={t("admin.waAgent.settings.title")}
      onSubmit={(event) => {
        void save(event);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      {canWrite ? null : <p className="text-base text-text-muted">{t("admin.waAgent.readOnly")}</p>}

      <Section title={t("admin.waAgent.status.title")}>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Switch
            name="agent-enabled"
            label={t("admin.waAgent.status.enabled")}
            checked={draft.enabled}
            disabled={disabled}
            onChange={(value) => {
              set("enabled", value);
            }}
          />
          <p className="text-sm text-text-muted">{t("admin.waAgent.status.enabledHint")}</p>
          <Notice tone="info">
            {t(
              data.verification.mode === "whatsapp_inbound"
                ? "admin.waAgent.status.codesOn"
                : "admin.waAgent.status.codesOff",
            )}{" "}
            <Link href="/admin/whatsapp" className="font-semibold underline">
              {t("admin.waAgent.status.codesLink")}
            </Link>
          </Notice>
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Switch
            name="guests-enabled"
            label={t("admin.waAgent.status.guests")}
            checked={draft.guestsEnabled}
            disabled={disabled}
            onChange={(value) => {
              set("guestsEnabled", value);
            }}
          />
          <p className="text-sm text-text-muted">{t("admin.waAgent.status.guestsHint")}</p>
        </div>
      </Section>

      <Section title={t("admin.waAgent.persona.title")} lead={t("admin.waAgent.persona.lead")}>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Field
            label={t("admin.waAgent.persona.text")}
            error={err("persona")}
            hint={t("admin.waAgent.persona.count", { count: draft.persona.length, max: 4000 })}
          >
            {(control) => (
              <Textarea
                {...control}
                name="persona"
                rows={8}
                value={draft.persona}
                disabled={disabled}
                onChange={(event) => {
                  set("persona", event.target.value);
                }}
              />
            )}
          </Field>
        </div>
        <Field label={t("admin.waAgent.persona.language")}>
          {(control) => (
            <Select
              {...control}
              name="language"
              value={draft.language}
              disabled={disabled}
              onChange={(event) => {
                set("language", event.target.value as Draft["language"]);
              }}
            >
              {(["ar_eg", "ar", "en"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`admin.waAgent.language.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.waAgent.persona.emoji")}>
          {(control) => (
            <Select
              {...control}
              name="emojiLevel"
              value={draft.emojiLevel}
              disabled={disabled}
              onChange={(event) => {
                set("emojiLevel", event.target.value as Draft["emojiLevel"]);
              }}
            >
              {(["none", "light", "lively"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`admin.waAgent.emoji.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Section>

      <Section title={t("admin.waAgent.timing.title")} lead={t("admin.waAgent.timing.lead")}>
        {num(
          "replyDelaySeconds",
          t("admin.waAgent.timing.delay"),
          "replyDelaySeconds",
          draft.replyDelaySeconds,
          (value) => {
            set("replyDelaySeconds", value);
          },
          3,
          60,
          t("admin.waAgent.timing.delayHint"),
        )}
        <div className="flex items-center">
          <Switch
            name="typingIndicator"
            label={t("admin.waAgent.timing.typing")}
            checked={draft.typingIndicator}
            disabled={disabled}
            onChange={(value) => {
              set("typingIndicator", value);
            }}
          />
        </div>
        {num(
          "perChatPerHour",
          t("admin.waAgent.caps.perChatPerHour"),
          "caps.perChatPerHour",
          draft.caps.perChatPerHour,
          (value) => {
            setCaps("perChatPerHour", value);
          },
          1,
          200,
        )}
        {num(
          "perChatPerDay",
          t("admin.waAgent.caps.perChatPerDay"),
          "caps.perChatPerDay",
          draft.caps.perChatPerDay,
          (value) => {
            setCaps("perChatPerDay", value);
          },
          1,
          1000,
        )}
        {num(
          "dailyTotal",
          t("admin.waAgent.caps.dailyTotal"),
          "caps.dailyTotal",
          draft.caps.dailyTotal,
          (value) => {
            setCaps("dailyTotal", value);
          },
          1,
          20000,
        )}
        {num(
          "maxReplyChars",
          t("admin.waAgent.caps.maxReplyChars"),
          "caps.maxReplyChars",
          draft.caps.maxReplyChars,
          (value) => {
            setCaps("maxReplyChars", value);
          },
          50,
          4000,
        )}
        {num(
          "maxMessagesPerTurn",
          t("admin.waAgent.caps.maxMessagesPerTurn"),
          "caps.maxMessagesPerTurn",
          draft.caps.maxMessagesPerTurn,
          (value) => {
            setCaps("maxMessagesPerTurn", value);
          },
          1,
          10,
        )}
        <NumField
          name="spendCapUsd"
          label={t("admin.waAgent.timing.spendCap")}
          hint={t("admin.waAgent.timing.spendCapHint")}
          value={draft.spendCapUsdMicros}
          onChange={(value) => {
            set("spendCapUsdMicros", value);
          }}
          error={err("spendCapUsdMicros")}
          disabled={disabled}
          format={usdTextFromMicros}
          parse={microsFromUsdText}
        />
      </Section>

      <Section title={t("admin.waAgent.discounts.title")} lead={t("admin.waAgent.discounts.lead")}>
        <div className="sm:col-span-2">
          <Switch
            name="discounts-enabled"
            label={t("admin.waAgent.discounts.enabled")}
            checked={draft.discounts.enabled}
            disabled={disabled}
            onChange={(value) => {
              setDiscounts("enabled", value);
            }}
          />
        </div>
        {num(
          "percentOff",
          t("admin.waAgent.discounts.percentOff"),
          "discounts.percentOff",
          draft.discounts.percentOff,
          (value) => {
            setDiscounts("percentOff", value);
          },
          1,
          50,
        )}
        {num(
          "validHours",
          t("admin.waAgent.discounts.validHours"),
          "discounts.validHours",
          draft.discounts.validHours,
          (value) => {
            setDiscounts("validHours", value);
          },
          1,
          168,
        )}
        {num(
          "perUserLifetime",
          t("admin.waAgent.discounts.perUserLifetime"),
          "discounts.perUserLifetime",
          draft.discounts.perUserLifetime,
          (value) => {
            setDiscounts("perUserLifetime", value);
          },
          1,
          5,
        )}
        {num(
          "dailyCap",
          t("admin.waAgent.discounts.dailyCap"),
          "discounts.dailyCap",
          draft.discounts.dailyCap,
          (value) => {
            setDiscounts("dailyCap", value);
          },
          0,
          1000,
        )}
        {num(
          "minUserMessages",
          t("admin.waAgent.discounts.minUserMessages"),
          "discounts.minUserMessages",
          draft.discounts.minUserMessages,
          (value) => {
            setDiscounts("minUserMessages", value);
          },
          0,
          50,
          t("admin.waAgent.discounts.minUserMessagesHint"),
        )}
        <div className="flex items-center">
          <Switch
            name="newCustomersOnly"
            label={t("admin.waAgent.discounts.newCustomersOnly")}
            checked={draft.discounts.newCustomersOnly}
            disabled={disabled}
            onChange={(value) => {
              setDiscounts("newCustomersOnly", value);
            }}
          />
        </div>
        <PlanPicker
          value={draft.discounts.plans}
          onChange={(value) => {
            setDiscounts("plans", value);
          }}
          canReadPlans={canReadPlans}
          disabled={disabled}
        />
      </Section>

      <Section title={t("admin.waAgent.media.title")} lead={t("admin.waAgent.media.lead")}>
        <MediaList
          value={draft.media}
          onChange={(value) => {
            set("media", value);
          }}
          disabled={disabled}
          errors={errors}
        />
      </Section>

      <Section title={t("admin.waAgent.voice.title")} lead={t("admin.waAgent.voice.lead")}>
        <div className="sm:col-span-2">
          <Switch
            name="voice-enabled"
            label={t("admin.waAgent.voice.enabled")}
            checked={draft.voice.enabled}
            disabled={disabled}
            onChange={(value) => {
              setVoice("enabled", value);
            }}
          />
        </div>
        <Field label={t("admin.waAgent.voice.replyMode")}>
          {(control) => (
            <Select
              {...control}
              name="replyMode"
              value={draft.voice.replyMode}
              disabled={disabled}
              onChange={(event) => {
                setVoice("replyMode", event.target.value as Draft["voice"]["replyMode"]);
              }}
            >
              {(["mirror", "sometimes", "never"] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`admin.waAgent.voice.mode.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {num(
          "sometimesPercent",
          t("admin.waAgent.voice.sometimesPercent"),
          "voice.sometimesPercent",
          draft.voice.sometimesPercent,
          (value) => {
            setVoice("sometimesPercent", value);
          },
          0,
          100,
        )}
        {num(
          "voiceMaxChars",
          t("admin.waAgent.voice.maxChars"),
          "voice.maxChars",
          draft.voice.maxChars,
          (value) => {
            setVoice("maxChars", value);
          },
          50,
          2000,
        )}
        {num(
          "dailyCharCap",
          t("admin.waAgent.voice.dailyCharCap"),
          "voice.dailyCharCap",
          draft.voice.dailyCharCap,
          (value) => {
            setVoice("dailyCharCap", value);
          },
          0,
          1_000_000,
          t("admin.waAgent.voice.dailyCharCapHint"),
        )}
        <Field label={t("admin.waAgent.voice.voiceId")} error={err("voice.voiceId")}>
          {(control) => (
            <Input
              {...control}
              name="voiceId"
              dir="ltr"
              value={draft.voice.voiceId}
              disabled={disabled}
              onChange={(event) => {
                setVoice("voiceId", event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.waAgent.voice.modelId")} error={err("voice.modelId")}>
          {(control) => (
            <Input
              {...control}
              name="modelId"
              dir="ltr"
              value={draft.voice.modelId}
              disabled={disabled}
              onChange={(event) => {
                setVoice("modelId", event.target.value);
              }}
            />
          )}
        </Field>
        <OptionalFraction
          name="stability"
          label={t("admin.waAgent.voice.stability")}
          value={draft.voice.stability}
          onChange={(value) => {
            setVoice("stability", value);
          }}
          error={err("voice.stability")}
          disabled={disabled}
        />
        <OptionalFraction
          name="similarityBoost"
          label={t("admin.waAgent.voice.similarityBoost")}
          value={draft.voice.similarityBoost}
          onChange={(value) => {
            setVoice("similarityBoost", value);
          }}
          error={err("voice.similarityBoost")}
          disabled={disabled}
        />
        <div className="flex items-center">
          <Switch
            name="transcribeIncoming"
            label={t("admin.waAgent.voice.transcribe")}
            checked={draft.voice.transcribeIncoming}
            disabled={disabled}
            onChange={(value) => {
              setVoice("transcribeIncoming", value);
            }}
          />
        </div>
        <VoiceKeyCard state={data.voiceKey} canWrite={canWrite} onChanged={onKeyChanged} />
        {canWrite ? (
          <VoiceTestBox keySet={data.voiceKey.set} voiceId={data.settings.voice.voiceId} />
        ) : null}
      </Section>

      <Section title={t("admin.waAgent.takeover.title")} lead={t("admin.waAgent.takeover.lead")}>
        {num(
          "takeoverPauseMinutes",
          t("admin.waAgent.takeover.pause"),
          "takeoverPauseMinutes",
          draft.takeoverPauseMinutes,
          (value) => {
            set("takeoverPauseMinutes", value);
          },
          5,
          10080,
        )}
        {num(
          "retentionDays",
          t("admin.waAgent.takeover.retention"),
          "retentionDays",
          draft.retentionDays,
          (value) => {
            set("retentionDays", value);
          },
          7,
          365,
          t("admin.waAgent.takeover.retentionHint"),
        )}
      </Section>

      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      {Object.keys(errors).length > 0 ? (
        <Notice tone="warning">{t("admin.waAgent.fixErrors")}</Notice>
      ) : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Button type="submit" name="save-wa-agent" loading={busy}>
            {t("admin.waAgent.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** The Settings tab: loads the agent settings and the voice-key state, saves the whole form at once. */
export function WaAgentSettingsTab({
  canWrite,
  canReadPlans,
}: {
  canWrite: boolean;
  canReadPlans: boolean;
}) {
  const resource = useResource("/admin/wa-agent/settings", waAgentAdminSettingsSchema);
  // A new key remounts the form only after a save of the settings themselves, so a key change
  // never throws away unsaved edits.
  const [generation, setGeneration] = useState(0);
  return (
    <ResourceBoundary resource={resource}>
      {(data) => (
        <SettingsForm
          key={generation}
          data={data}
          canWrite={canWrite}
          canReadPlans={canReadPlans}
          onSaved={() => {
            setGeneration((current) => current + 1);
            resource.reload();
          }}
          onKeyChanged={resource.reload}
        />
      )}
    </ResourceBoundary>
  );
}
