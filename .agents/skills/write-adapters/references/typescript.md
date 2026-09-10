# TypeScript adapters

## Converter

Import `Converter` and `ConverterException` from `@company.quicko/core`.

## Exception

Use `AdapterException` from `@company.quicko/core`. Keep the original error as
the cause.

Map known client errors before using the fallback:

```typescript
if (error instanceof UnauthorizedError) {
	throw new AdapterException("Unauthorized", error, 401);
}

if (error instanceof ApiError && error.statusCode && error.statusCode >= 500) {
	throw new AdapterException("Source Unavailable", error, 503);
}

if (error instanceof BaseException) {
	throw new AdapterException(error.message, error, error.code);
}

if (error instanceof Error) {
	throw new AdapterException(error.message, error, 500);
}

throw new AdapterException("Internal Server Error", error, 500);
```
