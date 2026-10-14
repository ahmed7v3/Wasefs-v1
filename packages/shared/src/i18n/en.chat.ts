import type { arChat } from "./ar.chat.js";

/** English for the `/ai` assistant: keys without an entry fall back to Arabic. */
export const enChat: Partial<Record<keyof typeof arChat, string>> = {
  "chat.title": "AI assistant",
  "chat.newChat": "New chat",
  "chat.untitled": "New chat",
  "chat.greeting": "Hello {name}, how can I help today?",
  "chat.greetingAnonymous": "Hello, how can I help today?",
  "chat.lead": "Ask about a medicine, understand a lab result, or attach a picture.",
  "chat.composer.label": "Your message",
  "chat.composer.placeholder": "Type your question here…",
  "chat.composer.send": "Send",
  "chat.composer.stop": "Stop answer",
  "chat.composer.attach": "Attach an image",
  "chat.mode.label": "Answer mode",
  "chat.mode.fast": "Fast",
  "chat.mode.balanced": "Balanced",
  "chat.mode.deep": "Deep",
  "chat.thinking.active": "Thinking…",
  "chat.thinking.done": "Thought for {seconds} s",
  "chat.sources.title": "Sources",
  "chat.history.title": "Chats",
  "chat.disclaimer": "General information to help you. It does not replace a doctor or pharmacist.",
  "chat.scrollDown": "↓ New",
  "chat.announce.done": "The answer is complete.",
};
