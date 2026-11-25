# Checklist

- Every `WHERE` column on a large table has an index.
- No query runs inside a loop over rows from another query.
- User input reaches the query only as a bound parameter.
- `SELECT *` is not used where a few columns would do.
