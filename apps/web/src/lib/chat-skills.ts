import { t } from "@wasfa/shared/i18n";
import { CHAT_SKILLS, type ChatSkill } from "@wasfa/shared/schemas/chat";

import type { SkillChipItem } from "@wasfa/ui";

export function skillLabel(skill: ChatSkill): string {
  switch (skill) {
    case "drug-info":
      return t("chat.skill.drug-info");
    case "lab-test-interpretation":
      return t("chat.skill.lab-test-interpretation");
    case "drug-interaction-check":
      return t("chat.skill.drug-interaction-check");
    case "imaging-educational":
      return t("chat.skill.imaging-educational");
    case "dose-calculator":
      return t("chat.skill.dose-calculator");
  }
}

/** The id of the prescription chip, which leaves the chat for the analysis page. */
export const RX_CHIP_ID = "rx";

/** Chips under the home composer: the prescription analysis (a link) first, then the chat skills. */
export function skillChipItems(): SkillChipItem[] {
  return [
    { id: RX_CHIP_ID, label: t("chat.skill.rx"), href: "/analyze" },
    ...CHAT_SKILLS.map((skill) => ({ id: skill, label: skillLabel(skill) })),
  ];
}
