# Corpus cases — expected lines (DRAFT, needs owner verification)

Images: `docs/testimg/` (gitignored; contain doctor/patient names and phones, NOT de-identified).
Before they enter the corpus bucket, names and phones must be masked (task 1.1).
`?` = Claude's reading is unsure. The owner must correct every line; the corpus only accepts owner-verified lines.

## rx-001 (`1.jpeg`): screenshot 720×1600, WhatsApp JFXX JPEG, handwritten, Arabic directions
| # | Name as written | Strength | Form | Directions |
|---|---|---|---|---|
| 1 | Averocoxib | 90 | T (tab) | ١×١ (٢٠) [قرص واحد يومياً بعد الأكل / علبة 20 قرص] |
| 2 | Metapsin plus | — | T (tab) | ١×١ قبل الأكل (١٠ أيام) |
| 3 | Dixvit | 10,000 | T (tab) | ٥ أيام أسبوعياً ما عدا الخميس والجمعة |

**Note:** The alternative reading («اروكسيكيب 900 / ميتابسين بلس / ديكسيت 1000») is produced by an automated OCR / AI transcription tool (such as ChatGPT Vision, Claude, or local pharmacy assistant bots) and is **largely incorrect**:
* **«اروكسيكيب 900»:** **خاطئ تماماً** في الاسم والتركيز (الدواء هو **Averocoxib 90**؛ ولا يوجد مسكن إتوريكوكسيب بتركيز 900 مجم).
* **«ميتابسين بلس»:** **صحيح بنسبة 100%** (*Metapsin plus*).
* **«ديكسيت 1000»:** **غير دقيق** في قراءة الاسم (الصحيح **Dixvit**)، و**خاطئ في التركيز** لنقص صفر واضح في الروشتة (الصحيح **10,000** وحدة دولية).

## rx-002 (`2.jpeg`): 1920×1648 photo, handwritten, clear
| # | Name as written | Strength | Form | Directions |
|---|---|---|---|---|
| 1 | Monuril | 3 gm | sachet | كيس كل ٤٨ ساعة [يُفرغ في نصف كوب ماء مساءً قبل النوم] |
| 2 | Diflucan | 50 | cap | ٢ كبسولة كل ١٢ ساعة أول يوم، ثم كبسولة كل ١٢ ساعة لمدة أسبوع |
| 3 | Cystone | — | tab | ٢ قرص كل ٨ ساعات [قرصان معاً ٣ مرات يومياً بعد الأكل] |

**Note:**
* **Monuril 3 gm** (*Fosfomycin*): مضاد حيوي لالتهاب مجرى البول والمثانة؛ يُفضل تناوله على معدة فارغة وقبل النوم مباشرة بعد إفراغ المثانة.
* **Diflucan 50** (*Fluconazole*): مضاد فطريات لعلاج عدوى المبيضات (*Candida*) المصاحبة؛ الجرعة تبدأ بجرعة تحميل (Loading dose) حبتين معاً كل 12 ساعة أول يوم، ثم تستمر بحبة كل 12 ساعة لمدة أسبوع كامل.
* **Cystone tab**: مطهر بولي ومدر للأملاح من خلاصات عشبية؛ يؤخذ قرصان كل 8 ساعات مع شرب كميات وفيرة من الماء.

## rx-003 (`3.jpeg`): owner's 2026-11-01 test, GI clinic, handwritten
| # | Name as written | Strength | Form | Directions |
|---|---|---|---|---|
| 1 | Relaxon | — | cap | كبسولة مساءً |
| 2 | Gabimedra | 5 | T (tab) | نصف ساعة قبل العشاء |
| 3 | Bepra | 20 | T (tab) | قرص قبل الإفطار يومياً |
| 4 | Riopan + | — | susp | م ك ٣ مرات بعد الأكل [ملعقة كبيرة ٣ مرات بعد الوجبات] |
| 5 | Flatidyl | — (40 mg) | T (chewable tab) | قرص مضغ ٣ مرات بعد الأكل |

**Note:**
* **Gabimedra 5:** دواء معتمد حديثاً في مصر من عائلة الجابابنتينويدات (*Mirogabalin*) لعلاج الألم العصبي المفرط وتهدئة آلام الأحشاء/القولون.
* **Riopan + & Flatidyl:** كلاهما يُؤخذ **بعد الأكل** لمعادلة الحموضة وتفتيت فقاعات الغازات، بينما **Bepra 20** يُؤخذ **قبل الإفطار** على الريق.

## Per case, also needed from the owner
- Surface where it failed (web / WhatsApp / both) and what the customer got (refusal «الصورة مش واضحة», wrong names, partial lines).
- Whether it read correctly on an earlier version (date).
