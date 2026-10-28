import type { arMedications } from "./ar.medications.js";

/** English for the medication search: keys without an entry fall back to Arabic. */
export const enMedications: Partial<Record<keyof typeof arMedications, string>> = {
  "medications.title": "Drug search",
  "medications.lead":
    "Search by drug name, active ingredient or barcode, and see the approximate price and alternatives.",
  "medications.search.label": "Search for a drug",
  "medications.search.placeholder": "Drug name, active ingredient or barcode",
  "medications.hint.title": "Type a drug name to start",
  "medications.hint.body":
    'Type at least two characters. Try "Panadol", Augmentin, paracetamol, or a barcode number.',
  "medications.hint.barcode": "Searching by barcode",
  "medications.loading": "Searching…",
  "medications.noResults.title": "We did not find a drug with that name",
  "medications.noResults.body":
    "Check the spelling, or search by the active ingredient (for example paracetamol) instead of the brand.",
  "medications.featureOff.title": "Drug search is not available right now",
  "medications.featureOff.body":
    "We are working on bringing it back. You can analyse a prescription or ask the assistant meanwhile.",
  "medications.rateLimited": "You searched a lot in a short time. Wait a minute and try again.",
  "medications.loadMore": "Show more",
  "medications.resultsLabel": "Drug search results",
  "medications.open": "Details of {name}",
  "medications.price.approx": "≈ {price}",
  "medications.price.updated": "Updated {date}",
  "medications.field.ingredients": "Active ingredient",
  "medications.field.strength": "Strength",
  "medications.field.form": "Form",
  "medications.field.pack": "Pack",
  "medications.field.units": "Units",
  "medications.field.manufacturer": "Manufacturer",
  "medications.field.category": "Category",
  "medications.field.barcode": "Barcode",
  "medications.field.price": "Price",
  "medications.detail.back": "Back to search",
  "medications.detail.priceNote": "Approximate price, updated {date}",
  "medications.detail.oldPrice": "Previous price: {price}",
  "medications.detail.alternatives.title": "Alternatives with the same active ingredient",
  "medications.detail.alternatives.lead":
    "Cheapest first. Ask your pharmacist before switching any drug.",
  "medications.detail.alternatives.empty": "No alternatives are recorded for this drug.",
  "medications.detail.analyze": "Analyze a prescription",
  "medications.detail.ask": "Ask the assistant",
  "medications.detail.disclaimer":
    "This information is for reference only and does not replace your doctor or pharmacist. Always follow your doctor's instructions.",
};
