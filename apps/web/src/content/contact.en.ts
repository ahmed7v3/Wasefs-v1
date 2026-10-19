import type { contact } from "./contact";

/** Copy of the contact page (English). */

export const contactEn: { [K in keyof typeof contact]: string } = {
  title: "Contact us",
  description:
    "Get in touch with the Wasfa AI team for any question, support request or suggestion. Leave your message and we will reply as soon as we can.",
  lead: "We would love to hear from you. Write to us about your question, problem or suggestion and we will reply by email or phone.",
  formTitle: "Send us a message",
  privacyNote:
    "Do not include medical data or passwords in your message. We use your details only to reply to you, under the privacy policy.",
  emergencyNote:
    "This page is not for medical emergencies. In an emergency, call the emergency services in your country.",
};
