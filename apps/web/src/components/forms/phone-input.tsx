"use client";

import { t } from "@wasfa/shared/i18n";
import { Input, Select } from "@wasfa/ui";
import { useState } from "react";

import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  countryByIso,
  splitInternational,
  toE164,
} from "../../lib/phone";

import type { FieldControlProps } from "@wasfa/ui";

/** What a `Field` hands its control; every part is optional so the input also works without one. */
type ControlProps = { [K in keyof FieldControlProps]?: FieldControlProps[K] | undefined };

export interface PhoneInputProps extends ControlProps {
  name: string;
  /** Receives the E.164 number (`+201012345678`), or an empty string while nothing is typed. */
  onChange: (e164: string) => void;
  onBlur?: (() => void) | undefined;
  defaultCountry?: string | undefined;
  disabled?: boolean | undefined;
}

/**
 * Country picker plus national number (DESIGN-SYSTEM §6.7). The user types the number the way they
 * dial it at home (`010...`); the form gets E.164. Pasting `+20...` or `0020...` picks the country.
 */
export function PhoneInput({
  name,
  onChange,
  onBlur,
  defaultCountry = DEFAULT_COUNTRY,
  disabled,
  ...control
}: PhoneInputProps) {
  const [iso, setIso] = useState(countryByIso(defaultCountry).iso);
  const [national, setNational] = useState("");
  const country = countryByIso(iso);

  return (
    <div className="flex gap-2">
      <div className="w-40 shrink-0">
        <Select
          name={`${name}Country`}
          aria-label={t("phone.country")}
          value={iso}
          disabled={disabled}
          autoComplete="country"
          onChange={(event) => {
            const next = countryByIso(event.target.value);
            setIso(next.iso);
            onChange(toE164(next.dial, national));
          }}
        >
          {COUNTRIES.map((option) => (
            <option key={option.iso} value={option.iso}>
              {/* LRM keeps "+20" from jumping to the other side of the Arabic name. */}
              {`${t(option.name)} ‎+${option.dial}`}
            </option>
          ))}
        </Select>
      </div>
      <Input
        {...control}
        name={name}
        ltr
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={t("phone.numberPlaceholder")}
        value={national}
        disabled={disabled}
        onBlur={onBlur}
        onChange={(event) => {
          const typed = event.target.value;
          const international = splitInternational(typed);
          if (international) {
            setIso(international.country.iso);
            setNational(international.national);
            onChange(toE164(international.country.dial, international.national));
            return;
          }
          setNational(typed);
          onChange(toE164(country.dial, typed));
        }}
      />
    </div>
  );
}
