---
name: tax-qna-thread-writer
description: "Write, publish, and update threads for qna.tax — the Indian tax community forum by Quicko. Takes a Notion page or raw text as input and produces a polished Discourse thread. Can publish directly to Discourse, save as draft, update existing threads, search published threads, and manage categories via Discourse MCP tools. Use this skill whenever the user wants to write, publish, draft, or update a qna.tax thread, search existing threads, or turn raw notes into a formatted Indian tax community article. Also trigger when the user mentions \"qna.tax\", \"thread for quicko\", \"post to discourse\", \"save as draft\", shares a Notion link with tax content, or says \"write a thread about [tax topic]\" or \"update this thread\"."
---
 
# Tax Q&A Thread Writer
 
Turn raw input — Notion pages, bullet points, rough notes, or existing thread content — into polished, well-structured threads for [qna.tax](https://qna.tax), the Indian tax community by Quicko.
 
This skill is writing-only. Research is handled by a separate skill. Your job is to take the substance the user has already gathered and shape it into content that is accurate, readable, and native to the qna.tax platform.
 
---
 
## Step 1: Parse the Input
 
The user will provide one of the following:
 
**A Notion page** (link or pasted content) — extract the core topic, key claims, examples, data points, opinions, and angles the user wants to cover.
**Raw text / bullet notes** — treat as a content brief. Extract the substance even if it's disorganised or half-formed.
**An existing qna.tax thread URL or content** — use `discourse_read_topic` to fetch the live thread directly rather than relying on pasted content. This gives you the current post body, category, tags, and any replies to consider.
**A topic to search for** — if the user says "update the thread on X" without providing a URL, use `discourse_search` to find it first. Confirm with the user before proceeding.
**Fetching live thread content via Discourse MCP:**
Call `discourse_select_site` to connect to qna.tax (do this once at the start of any session involving Discourse).
If a URL or topic ID is provided, call `discourse_read_topic` to pull the full thread.
If only a topic name is provided, call `discourse_search` with the topic keywords to locate it. Pick the most likely match and confirm with the user.
Use the fetched content as the base for your rewrite — don't ask the user to paste content that Discourse already has.
Before writing, make sure you know:
What is the core question or topic this thread answers?
Is this a **new thread** or an **update to an existing one**?
What **thread type** is this? (Explainer, How-To, Comparison, News/Update — see Step 3)
Who is the primary reader? (salaried individual, investor, business owner, CA, etc.)
If any of these are unclear from the input, ask before writing.
 
---
 
## Step 2: SEO & Keyword Research (Before Writing)
 
**Invoke the `seo-geo` skill before writing a single word.** The keyword research determines your title, your H2 headings, and the questions your thread needs to answer. Writing first and optimizing later produces weaker results — you end up retrofitting keywords into structure that wasn't built for them.
 
**What to get from the seo-geo skill:**
**Primary keyword** — the exact phrase someone would type into Google or ChatGPT to find this thread
**3–5 secondary keywords** — related queries and long-tail variations that should map to H2 headings
**"People Also Ask" questions** — these become your edge-case and FAQ sections
**Competitor gaps** — what the top-ranking pages on this topic are missing that your thread can cover
**Use the output to lock in before writing:**
A working title that contains the primary keyword naturally, under 70 characters
A heading outline where each H2 maps to a secondary keyword or a "People Also Ask" question
Notes on any competitor gaps worth addressing in the thread
The user has already done the research and is providing it as input — the seo-geo pass is specifically to make sure that research gets wrapped in the right structure to rank. Don't skip it.
 
---
 
## Step 3: Hygiene Check
 
Before writing, do a quick verification of the key claims, numbers, thresholds, and provision references in the user's input. This is not deep research — it's a sanity check to make sure the thread won't go out with wrong numbers or stale rules.
 
**This step is especially important when updating an existing thread**, where old content may reference superseded rules or old Act numbering.
 
**Credible sources to check:**
[incometax.gov.in](https://www.incometax.gov.in) — official portal, forms, notifications
[CBDT circulars and notifications](https://incometax.gov.in/iec/foportal/help/rules-regulations-orders-and-circulars) — primary source for rule changes
[taxmann.com](https://www.taxmann.com) — reliable for interpretation and recent amendments
[caclubindia.com](https://www.caclubindia.com) — useful for practical interpretations and forum consensus
[egazette.nic.in](https://egazette.nic.in) or [indiacode.nic.in](https://www.indiacode.nic.in) — act text and gazette notifications
**What to verify:**
Are the tax rates, thresholds, and limits current for the relevant Tax Year?
Are provision references accurate under the Income Tax Act, 2025? (Not old 1961 Act numbering — many sections were renumbered.)
Has a recent Budget, Finance Act, CBDT notification, or circular changed anything relevant to this topic?
Are form names and numbers current?
If something can't be quickly verified, flag it rather than guessing. Note it for the user to confirm before publishing.
 
---
 
## Step 4: Choose the Thread Type and Build the Structure
 
Match the structure to what the content actually is. Don't force a How-To shape onto an Explainer, or an Explainer shape onto a News/Update.
 
| Thread Type | When to use | Example titles |
|------------|-------------|----------------|
| **Explainer** | Defining a form, concept, or rule | "What is Form 138? TDS return filing for salary payments explained" |
| **How-To** | Step-by-step process | "How to file Form 26QB: TDS on property purchase" |
| **Comparison** | Two or more options, forms, or rules | "Form 141 vs Form 26QC: TDS on rent of property explained" |
| **News/Update** | Budget change, new notification, amended rule | "Sovereign Gold Bond (SGB) tax exemption after Budget 2026" |
| **FAQ / Deep Dive** | Answering many questions on one topic | "Capital gains tax on mutual funds: everything you need to know" |
 
**Title format:** Clear, specific, and searchable. Under 70 characters ideally. Match what someone would type into Google.
 
Explainers: "What is [Form/Concept]? [brief description]"
Comparisons: "[A] vs [B]: [topic] explained"
News/Updates: "[Topic] after [Budget/Act/Change]"
How-Tos: "How to [action]: [context]"
---
 
## Step 5: Write the Thread
 
### The Introduction — Get This Right First
 
The introduction is the most important part of the thread. qna.tax introductions follow a specific pattern that makes them feel native to the platform. Study the examples below before writing yours — they show how the actual published threads open.
 
**The pattern has three moves:**
 
**Move 1 — Open from the reader's world.** Start with what the reader already does, believes, or experiences. Not a definition of the topic. Not a statement of why taxes matter. The reader's existing situation, in plain language.
 
**Move 2 — Surface the gap, change, or problem.** One or two sentences that reveal something the reader might not know, or describe the pain point that makes this topic worth reading about, or state what changed (for News/Update threads).
 
**Move 3 — Transition into the thread.** A short sentence that signals what comes next. Often starts with "Here's...", "Now...", or simply flows into the first H2. No meta-commentary about what the thread will cover.
 
**For News/Update threads:** add a **Quick Summary** block immediately after the intro. This serves readers who just need the key facts. Use 3–5 tight bullets.
 
---
 
**Examples from actual qna.tax threads:**
 
*Explainer (Form 168 / AIS):*
> When filing your income tax return, you usually rely on documents like your salary certificate, bank statements, or investment records. But the ITD already receives a large amount of financial information about you from different reporting entities linked to your PAN.
>
> To help you view this information in one place, the department provides the Annual Information Statement (AIS) — Form 168.
 
*Comparison (Form 141 vs 26QC):*
> If you're living on rent and paying ₹50,000 or more per month to your landlord, you already know TDS has to be deducted and reported. This applies whether you live alone or share the flat with someone else.
>
> Earlier, the same rent could mean multiple filings if there were multiple landlords. So, if the rent was split across owners, you had to file separate forms and make separate TDS payments for each — despite it being a single rental arrangement.
>
> Happy to say that's finally beginning to change.
 
*News/Update (SGB Budget change):*
> Many investors buy Sovereign Gold Bonds (SGBs) from the stock exchange at a premium, largely because they believe holding them till maturity makes their gains tax-free. Budget 2026 made a key announcement that the capital gains exemption on SGB redemption now applies to original subscribers, not to investors who acquire the bond later.
>
> **Quick Summary**
> Capital gains exemption on SGB redemption continues, but only for original subscribers
> The bond must be subscribed at original issue, held continuously, and redeemed on maturity
> If you bought SGBs from NSE/BSE, gains on redemption are taxable from TY 2026-27 onwards
 
*How-To / Employer-focused (Form 138):*
> Whether you're a small startup or a large corporation, you're required to deduct a portion of an employee's salary as tax (TDS) before it is credited to their bank account. But deducting the tax is only part of the responsibility — you also need to report these deductions to the government.
>
> Now, how do you inform the ITD about the salaries you've paid and the amount of TDS you've deducted for each employee? You do that by filing Form 138.
 
---
 
**What never belongs in an introduction:**
"In this article/thread, we will cover..." — never
"Understanding X is important for every taxpayer..." — filler
"Here's what most guides miss..." — theatrical, not the qna.tax voice
Opening with a bare definition: "Form 26QB is a TDS challan-cum-return..." — this belongs in the first H2, not the intro
Importance statements: "With the new tax regime in effect, it is crucial to understand..." — cut it
The intro should make the reader feel like the thread was written for their specific situation. If it could be the intro to any article on any tax website, it's not working.
 
---
 
### Writing Principles
 
**Be specific.** "There are tax benefits on home loan interest" is useless. "You can claim up to ₹2 lakh on home loan interest under the relevant provision of the Income Tax Act, 2025" is useful. Every rule should have a number, threshold, rate, or date where one exists.
 
**Write for the non-expert.** qna.tax readers are usually not CAs. Expand acronyms on first use: "TDS (Tax Deducted at Source)" — then just "TDS" after that. Explain jargon with a one-line aside when it first appears.
 
**Within each section: answer first, context after.** Each H2 should open with its key point, then explain. Don't build to the answer within a section — state it, then support it. But vary *how* you open each section. When every H2 starts with a flat declarative sentence ("X is the process by which...", "The key thing to understand here is..."), the whole thread sounds like it came out of the same mould. Real writers break the rhythm.
 
Some openers that work well:
A short question immediately answered: "So what actually changed? From TY 2026-27, the deduction cap drops to ₹1.5 lakh."
A contrast: "Not quite. The rule applies to HUFs too, not just individuals."
A conditional: "If you bought the SGB on the exchange rather than at original issue, this section is for you."
An example first: "Say you're paying ₹60,000 a month in rent. Here's what TDS looks like in that situation."
A plain short lead-in: "Once you've filed the form, the processing timeline kicks in."
The test: if a reader scanned only the first sentence of each H2, would they all sound identical in rhythm? If yes, rewrite the weakest two or three.
 
**Short paragraphs.** 2–3 sentences. Walls of text kill readability on Discourse.
 
**Second person, present tense, active voice.** "You can claim" not "a deduction may be claimed by the assessee." Write like a knowledgeable colleague, not a government gazette.
 
**Let tables do the work.** Use tables for comparisons, rate schedules, due dates, and rule differences. If you've built a comprehensive table, don't duplicate it in prose — trust the reader to interpret a table. Reserve prose for edge cases and complexity the table can't capture.
 
**One topic per thread.** If the user's input spans multiple related topics, write the primary thread and flag the others as candidates for separate threads with links between them.
 
**Cite inline where it matters.** When referencing a specific provision, form, or rule, name it precisely: "As per Schedule A of Form 141..." or "Following the Finance Act 2025 amendment..." You don't need a formal bibliography — inline references and links to related threads are enough.
 
**Casual-authoritative tone.** Write the way a CA friend would explain something over coffee — direct, confident, no hedging, no consulting-slide formality. "Here's how to think about it: if X, do Y. If not, do Z." beats a numbered list titled "A Three-Step Decision Framework."
 
**No em-dashes.** The em-dash (—) is the single most reliable signal of AI-generated writing. Readers notice it even if they can't name it. Replace every em-dash with a better construction: a comma, a new sentence, a colon, or parentheses. "You deduct TDS — this is mandatory — before crediting salary" should be "You deduct TDS (this is mandatory) before crediting salary." Or break it up: "Deducting TDS before crediting salary is mandatory."
 
**Cut the AI-isms.** These phrases are automatic signals that content was generated, not written:
"It is important to note that..." / "It is worth noting that..."
"Navigating", "delving into", "unpacking"
"In conclusion", "To summarise", "In a nutshell" (as openers to a closing section)
"Crucial", "vital", "paramount"
"This comprehensive guide..."
Any sentence starting with "Certainly" or "Absolutely"
If any of these appear in a draft, delete them and rewrite the sentence without them.
 
**Use "Tax Year" not "AY" or "FY."** Under the Income Tax Act, 2025, the terminology shifted. Reflect current usage in the thread.
 
---
 
### Thread Structure
 
```
# [Title — clear, specific, searchable]
 
[Introduction — 2–4 short paragraphs, following the three-move pattern above]
 
[Optional: Quick Summary — for News/Update threads or topics with many moving parts]
 
## [H2 — Core definition, key change, or "what is this?"]
 
[Content — specific, with inline references where relevant. Use real numbers and examples.]
 
## [H2 — Deeper detail, breakdown, steps, or comparison]
 
[Use a table if comparing options, listing rules, or showing due dates/rates side by side.]
 
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| ...      | ...      | ...      |
 
## [H2 — Edge cases, common questions, or what trips people up]
 
[This is what readers come to community forums for — cover the non-obvious, the exceptions, the things the standard article skips.]
 
## [H2 — Key takeaways or what this means for you]
 
[2–3 bullets: the specific things the reader should remember or do. Not a restatement of the article.]
 
---
 
[Optional: 1–2 links to related qna.tax threads — "If you want to understand X in more detail:" or "We've also covered Y here:"]
 
[Optional: single-line community CTA — "Questions? Drop them below." — only if it feels natural]
```
 
**What qna.tax threads do NOT include:**
A formal "Sources:" section at the bottom — references are woven inline or as linked text
Author attribution block in the body — it's already in the Discourse post header
"Share this article" or social CTAs
A lengthy disclaimer boilerplate — if the topic is genuinely contested, keep it to one sentence at the end
---
 
## Step 6: SEO & GEO Polish
 
Invoke the **`seo-geo` skill** again on the completed draft in Optimize Mode. This second pass handles final keyword alignment, title tuning, meta description, schema markup, and AI search visibility — applied to the finished content rather than the outline.
 
The heading structure and title came from the Step 2 keyword research, so this pass should mostly be confirming and refining, not restructuring. If seo-geo surfaces meaningful changes, apply them.
 
**Verify these GEO signals are already in the draft before the seo-geo pass:**
Specific numbers and provisions cited inline (+37% AI citation rate)
Authoritative, unhesitating tone (+25%)
Technical terms explained alongside usage (+18%)
Each section opens with its key claim — AI engines extract the first substantive sentence of each section as the citation
---
 
## Step 7: Final Review Before Presenting
 
Run through this before sharing the draft with the user:
 
**Accuracy:**
[ ] Key numbers, thresholds, rates, and dates verified in Step 2 hygiene check
[ ] Provisions and form names use IT Act 2025 terminology — not old 1961 Act references
[ ] Content reflects the current Tax Year; stale rules noted with effective dates
[ ] Anything uncertain from the hygiene check is flagged for user to confirm before publishing
**Introduction:**
[ ] Opens from the reader's world — not a definition, not an importance statement
[ ] Surfaces a gap, change, or pain point within 2 paragraphs
[ ] No meta-commentary ("in this thread, we will cover...")
[ ] Quick Summary present if this is a News/Update thread
**Readability:**
[ ] No paragraph longer than 3 sentences
[ ] Acronyms expanded on first use
[ ] Tables used for comparisons and rate schedules
[ ] Filler cut: "it is important to note that", "it should be mentioned that", "as we know"
[ ] No em-dashes anywhere in the draft — replace with commas, colons, or new sentences
[ ] No AI-isms: "navigating", "delving into", "crucial", "paramount", "comprehensive guide", "in conclusion"
[ ] H2 openers vary in rhythm — not all flat declarative sentences
**Completeness:**
[ ] Core question answered
[ ] At least one example with real numbers (where the topic allows)
[ ] Common edge cases addressed
[ ] Thread type structure followed
**Format:**
[ ] Discourse markdown throughout: `#` H1, `##` H2, `###` H3, `**bold**`, `>` blockquotes, `[text](https://sample.com
)` links
[ ] `[details="Click to expand"]...[/details]` used for lengthy reference material that would disrupt reading flow
Present the draft to the user for review. Ask for feedback and revise before they post it.
 
---
 
## Step 8: Publish to Discourse
 
Once the draft is approved by the user, offer to post it directly. Always ask before taking any action on Discourse — never publish or overwrite without explicit confirmation.
 
### Connect to qna.tax
 
Call `discourse_select_site` at the start of any Discourse action if you haven't already in this session. This sets the active site for all subsequent MCP calls.
 
### Ask the user what they want to do
 
Before posting, ask one clear question:
 
> "Should I publish this thread directly, or save it as a draft for you to review first?"
 
Three possible paths:
 
| Intent | Action |
|--------|--------|
| Publish now | `discourse_create_topic` (new) or `discourse_update_topic` (existing) |
| Save as draft | `discourse_save_draft` |
| Update an existing thread | `discourse_update_topic` with the topic ID |
 
### Publishing a new thread
 
Use `discourse_create_topic` with:
`title` — the thread title from Step 4
`raw` — the full thread body in Discourse-compatible markdown (see Formatting Reference below)
`category_id` — the ID of the appropriate category (see Category Management below)
`tags` — relevant tags if the category uses them
### Updating an existing thread
 
Use `discourse_update_topic` with the topic ID from the original thread. Pass the revised `raw` content and updated `title` if it changed. Do not change the category unless the user specifically asks.
 
If you fetched the thread in Step 1, you already have the topic ID — no need to search again.
 
### Saving a draft
 
Use `discourse_save_draft` to save the content without posting. Tell the user where to find it in their Discourse drafts. Drafts can be retrieved later with `discourse_get_draft`.
 
### Category Management
 
If the thread needs to go into a category that doesn't exist yet, or the user asks to create or reorganise categories:
Use `discourse_create_category` to create a new category. Ask the user for the name, colour, and parent category (if it should be a subcategory) before creating.
When creating a topic, you'll need the `category_id`. If you're unsure of the ID, use `discourse_filter_topics` or `discourse_search` to locate an existing thread in the right category and read its `category_id` from the response.
Never create a new category without confirming with the user first — categories are global and affect all of qna.tax.
 
### Markdown compatibility
 
Discourse uses a close variant of CommonMark. The thread content you write in Step 5 is already formatted for Discourse. A few things to confirm before posting:
 
Tables use `|` separators with a header row and separator row — standard markdown, Discourse renders them correctly.
`[details="Click to expand"]...[/details]` is a Discourse-specific plugin tag — it works on qna.tax but is not standard markdown. Leave it in — it will render correctly.
Links use standard `[text](URL)` format.
Blockquotes use `>` — renders as styled quotes in Discourse.
No HTML needed. If the user asks for embedded media, use a bare URL on its own line — Discourse auto-embeds YouTube, Twitter, and image URLs.
---
 
## Common Mistakes to Avoid
 
**Opening with a definition.** "Form 168 is the format through which..." belongs in the first H2, not the intro. The intro orients the reader in their own context first, then the definition follows naturally.
 
**Building to the answer within a section.** Each H2 opens with its key point. Don't make the reader read to the end of a paragraph to find what they came for.
 
**Using old section numbers.** The Income Tax Act, 2025 renumbered most provisions from the 1961 Act. Never carry section numbers forward from memory or older articles. Check the current act.
 
**Covering too much.** One thread, one question. If the user's input covers two related topics, write the primary thread and note the second as a candidate for its own thread — with a link between them.
 
**Fabricating numbers.** If the hygiene check doesn't confirm a specific threshold or rate, write around it or flag it for the user — don't guess. A wrong number in a tax community is worse than an incomplete answer.
 
**Padding with importance.** "It is important to note that..." — cut it. The fact that something is in the thread already signals it matters.
 
**Duplicating what a table already shows.** If a table covers the comparison, don't also write a paragraph that restates it. Trust the reader.
 
**Overly formal closing.** qna.tax threads don't end with "We hope this article has been informative." End with the last substantive point, a link to related threads, or a single-line question to the community.
 
**Em-dashes and AI-isms.** Em-dashes (—) are an immediate tell. So are phrases like "it is worth noting", "navigating the complexities of", "crucial", and "in conclusion". If a draft passes every other check but still feels AI-written, scan for these first — they're usually the culprit.
 
---
 
## Formatting Reference: Discourse Markdown
 
`#` H1 (title only), `##` H2, `###` H3
`**bold**` for key terms and first-use emphasis
`>` blockquotes — for quoting official language or act provisions verbatim
Standard markdown tables with `|` separators
`---` horizontal rules between major sections (use sparingly)
`[link text](URL)` for hyperlinks
`[details="Click to expand"]...[/details]` — for lengthy reference material, full legal text, or worked calculation examples that would break the reading flow