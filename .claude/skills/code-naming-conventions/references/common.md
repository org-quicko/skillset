# Common naming conventions

## Use one name for each concept

- If the repository calls something a `customer`, keep `customer` in every
  related name. Do not call the same concept `client` or `user`.

## Variables

- Name a value for what it represents. Use `pendingOrders` instead of `data`
  and `totalTax` instead of `result`.
- Use a noun for a non-boolean value: `invoice` or `taxAmount`.
- Use a singular name for one value and a plural name for many: `invoice` and
  `invoices`.
- Add `List`, `Array`, or `Map` only when callers need to know the collection
  type. Prefer `invoices` to `invoiceList` when they do not.
- Name a boolean variable for what `true` means. Use `isReady` for a state,
  `hasErrors` for presence, `canRetry` for an ability, and `shouldRefresh`
  for a decision.
- Give related values matching names. Make the difference clear:
  `previousBalance` and `currentBalance`, or `taxWithIndexation` and
  `taxWithoutIndexation`.
- Include details readers need to use a variable correctly:
  `sourceAccountId`, `timeoutMs`, or `invoicesByCustomerId`.

## Functions and methods

- Begin an action name with a verb that says what it does:
  `calculateTax`, `getSettlements`, or `deleteTaxPayer`.
- Name a boolean function or method for what `true` means:
  `isReady()`, `hasErrors()`, `canRetry()`, or `shouldRefresh()`.

## Classes and types

- Use a noun or noun phrase: `Invoice` or `TaxReliefCalculator`.
