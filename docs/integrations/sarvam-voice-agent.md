# Sarvam voice agent — the setup Morbeez calls

AI Calling has a customer called by **one Sarvam Voice Agents agent**, built
once in Sarvam's dashboard (apps.sarvam.ai). Morbeez places each call through
Sarvam's instant-outbound API, gives the agent the call's facts as **input
variables**, and reads what came of it from the **output variables** Sarvam
sends back when the call ends. This page is the contract between the two: build
the agent to it, and the code (`apps/backend/src/modules/ai/channels/call-brief.ts`,
`voice.service.ts`) needs nothing else.

The client's requirement (2 Nov 2026): a natural conversation in the customer's
language that understands the answer and follows up — not "press 1, press 2".
The agent talks; it never changes the books. Placing a changed order or
recording a payment stays the owner's, from what the call reports.

## 1. How a call runs

1. The owner picks a customer and what the call is about on AI Calling; the
   app shows what the agent will be told, then places it. Customers marked
   **Do not call** are refused before anything is sent.
2. Morbeez sends `POST /api/outbounds/v1/orgs/{org}/workspaces/{workspace}/outbounds`
   with the agent (`SARVAM_VOICE_APP_ID`, `SARVAM_VOICE_APP_VERSION`), the
   number to call from (`SARVAM_VOICE_CONNECTION_ID`, `SARVAM_VOICE_FROM_NUMBER`),
   the customer's number, the input variables below, the language to open in
   (`app_overrides.initial_language_name`), and a webhook URL made for this
   call.
3. Sarvam rings the customer; the agent holds the conversation.
4. When the call ends, Sarvam posts its report to that URL
   (`/webhooks/sarvam/calls/{id}?token=…`). Morbeez keeps the status, the
   output variables, a summary and the conversation (Sarvam's English
   transcript), and AI Calling shows them. Nothing to configure for the
   webhook in Sarvam's dashboard — each call carries its own.

## 2. Input variables

Create each on the agent's **Variables** tab as an input, **default value
empty**. Every one is a string; those that aren't this call's are empty.

| Variable | Filled for | Example |
|---|---|---|
| `business_name` | every call | `Morbeez Fresh` |
| `customer_name` | every call | `Hotel Sagar` |
| `call_purpose` | every call | one of `payment_reminder`, `order_reminder`, `order_confirm`, `quantity_confirm`, `follow_up` |
| `customer_language` | every call | `Malayalam` (also English, Kannada, Tamil) |
| `amount_due` | `payment_reminder` | `12,500 rupees` |
| `due_since` | `payment_reminder` | `2026-10-01` (the oldest unpaid invoice's due date; may be empty) |
| `order_number` | `order_confirm`, `quantity_confirm` | `D-00042` |
| `delivery_date` | `order_confirm`, `quantity_confirm`, `order_reminder` | `2026-11-03` |
| `order_lines` | `order_confirm`, `quantity_confirm` | `20 kg Tomato at 30 rupees per kg; 5.5 kg Onion at 40 rupees per kg` |
| `order_total` | `order_confirm`, `quantity_confirm` | `820 rupees` |
| `usual_order` | `order_reminder` | `20 kg Tomato; 15 kg Onion` |
| `topic` | `follow_up` | `Ask how the last delivery of onions was, and whether they want the same next week.` |

The numbers are worked out by Morbeez from the books when the call is placed;
the agent must only repeat them, never work anything out.

## 3. The agent's instructions

A starting point for the agent's prompt — insert the variables with `@` in
Sarvam's canvas where `@name` appears. Test it in each language before going
live, and have a native speaker listen to a few calls (the client's answer 9).

> You are calling @customer_name on behalf of @business_name, a fresh produce
> supplier, in @customer_language. Speak naturally and politely, in short
> sentences, as the business's own staff would. Switch language if the customer
> does. Say who you are and why you are calling at the start.
>
> Only use the facts given here — never make up an amount, price, quantity or
> date. You cannot change orders, take payments or give discounts: you note what
> the customer wants and tell them the team will confirm. Never ask for card
> numbers, OTPs, UPI PINs or passwords.
>
> What the call is about depends on @call_purpose:
>
> - **payment_reminder** — remind them, politely, that @amount_due is due
>   (since @due_since, if given). Ask when they can pay. If they say they have
>   already paid, thank them and note how and when they say they paid.
> - **order_reminder** — they usually order @usual_order. Ask whether they want
>   it for @delivery_date, the same or changed. Note any change exactly.
> - **order_confirm** — confirm their new order @order_number for
>   @delivery_date: @order_lines, @order_total in all. Ask whether it is right;
>   note any change exactly.
> - **quantity_confirm** — their order @order_number for @delivery_date is
>   @order_lines (@order_total). It is quite different from what they usually
>   take; check the quantities and prices are what they meant, and note any
>   change exactly.
> - **follow_up** — @topic.
>
> If they are busy, ask when to call back. If you reached the wrong person,
> apologise and end the call. If they ask not to be called again, apologise,
> say you will tell the team, and end the call. Keep the call short — under
> two minutes when you can.

## 4. Output variables

Create each on the **Variables** tab as an output, with this type and
extraction prompt. Sarvam fills them after the call and sends them back as
`final_agent_variables`; Morbeez reads these five (any others are kept and
shown as they are).

| Variable | Type | Extraction prompt |
|---|---|---|
| `call_outcome` | Enum: `confirmed`, `change_requested`, `will_pay`, `already_paid`, `call_later`, `not_interested`, `wrong_person`, `no_decision` | What came of the call. `confirmed`: they agreed the order or reminder as it was. `change_requested`: they want a quantity, product, price or date changed. `will_pay`: they said they will pay. `already_paid`: they said they have paid. `call_later`: they asked to be called another time. `not_interested`: they don't want it, or asked not to be called again. `wrong_person`: the person who answered isn't the customer and can't speak for them. `no_decision`: none of these. |
| `requested_changes` | String | Exactly what they want changed, in English, with quantities and units (e.g. "Tomato 25 kg instead of 20 kg; no onions"). Empty if nothing. |
| `promised_payment_date` | String | The date they said they will pay, as YYYY-MM-DD if a date can be worked out, else their words. Empty if none. |
| `callback_time` | String | When they asked to be called back, in their words or as a date and time. Empty if not asked. |
| `call_summary` | String | Two sentences in English for the business owner: what the customer said and what the team should do next. Mention it if they asked not to be called again. |

An outcome Morbeez doesn't know is shown as "No decision"; nothing breaks.

**Successful when:** `call_outcome` is not `no_decision` — for Sarvam's own
analytics only; Morbeez doesn't read it.

## 5. Languages and voice

Enable English, Malayalam, Kannada and Tamil on the agent. Morbeez opens each
call in the customer's language (set on the customer, `initial_language_name`
= `English` / `Malayalam` / `Kannada` / `Tamil`). Pick a voice the client is
happy with for each.

## 6. Telephony

| Choice | When | Notes |
|---|---|---|
| **Rent a number from Sarvam** (Deploy → Phone Numbers → Add Connection → Rent from Sarvam) | Start here — the MVP | KYC first (individual or company). Paid from the Sarvam wallet every 30 days; if the wallet runs short the number is released. The number shows as a "Sarvam Vobiz" connection. |
| **Bring your own** — Exotel, Twilio, Plivo, Tata Smartflo and others | At volume, or to call from an existing business number | The provider's own account, KYC and per-minute rates; connected under Deploy → Phone Numbers → Bring Your Own. |

Costs at the time of writing (Nov 2026; check Sarvam's pricing page before
quoting): a rented number about ₹59 for 30 days, calls about ₹0.20 per
30-second pulse, the agent about ₹3.50 a minute pay-as-you-go.

Calling customers is a business call under TRAI's rules (NCPR / DND, calling
hours): the business stays responsible for whom it calls and when. Do Not Call
on the customer is the business's own list, on top of that.

## 7. Settings on the server

`apps/backend/.env.example`, section 4d: `SARVAM_VOICE_API_KEY`,
`SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`, `SARVAM_VOICE_APP_ID`,
`SARVAM_VOICE_APP_VERSION` (the committed version to call with — raise it
after committing a new one), `SARVAM_VOICE_CONNECTION_ID`,
`SARVAM_VOICE_FROM_NUMBER`, and `PUBLIC_API_URL`. Then Settings →
Integrations → "Allow AI calls to customers from AI Calling".

## 8. Checking it

1. Put your own phone on a test customer (Customers → Edit), language as you
   like.
2. AI Calling → **Follow-up call…** → that customer, a topic → **Call with AI**.
3. Answer and talk. When you hang up, the call on AI Calling shows the
   outcome, the summary, what was collected and the conversation, within a
   few seconds of Sarvam's report.
4. Then a payment reminder and an order confirmation, in each language.

The end-to-end suite (`testing/e2e/suites/integrations-e2e.js`) runs the same
flow against a local stand-in for Sarvam.
