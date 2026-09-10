---
name: write-adapters
description: Write or review an adapter that translates an external client's interface into the interface used by its consumers. Use when adding, changing, or reviewing an adapter.
disable-model-invocation: true
---

# Write adapters

An adapter lets consumers use an external client through a simple contract. The
adapter keeps client-specific request and response objects out of consumer code
and maps client failures to `AdapterException`.

## Keep client objects inside the adapter

Define adapter inputs and outputs with primitive types or application-owned API
beans. Do not expose external client objects or client-only fields through the
adapter interface.

Minimize adapter inputs. Reuse values across client fields and set fixed client
values inside the adapter.

For example, if a client requires the same TAN in both `userId` and `tan`,
accept `tan` once and set both client fields inside the adapter.

## Convert requests and responses

Keep the mapping between application-owned API beans and external client objects
in converters. Each converter must implement the `Converter<T1, T2>` interface
from Company Quicko Core.

Use the API bean as `T1` and the request or response type defined by the external
client as `T2`. `convertTo` builds the client object. `convertFrom` builds the
API bean.

Add fixed, duplicated, generated, or client-formatted fields during conversion.

## Exception

Every failure from an adapter method must be an `AdapterException`. Pass the
original error as the cause.

For example, if a converter throws `ConverterException`, the adapter method
must throw `AdapterException` with the `ConverterException` as its cause.

Map known client failures to a message and a standard HTTP status code that
describe the failure to the consumer.

```text
throw new AdapterException("Unauthorized", error, 401);
throw new AdapterException("Too Many Requests", error, 429);
throw new AdapterException("Source Unavailable", error, 503);
```

## Structure the adapter

Replace `X` with the name of what the adapter does.

Define `XAdapter` as an interface under `adapter`. Define `XAdapterImpl` under
`adapter/impl` and make it implement `XAdapter`.

For example, use `TracesAuthenticationAdapter` and
`TracesAuthenticationAdapterImpl`.

Make consumers depend on `XAdapter`.

If several clients implement the same interface, include the client name in the
implementation name. For example, use `CashfreePanVerificationAdapterImpl`.

## Apply the language-specific conventions

Before writing or reviewing the adapter, read the reference for the adapter's
language:

- For TypeScript, read [references/typescript.md](references/typescript.md).
- For Java, read [references/java.md](references/java.md).
