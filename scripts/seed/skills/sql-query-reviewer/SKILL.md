---
name: sql-query-reviewer
description: Reviews SQL queries for missing indexes, N+1 patterns and unsafe string interpolation. Use when a diff touches SQL.
allowed-tools: Read Grep
metadata:
  dialect: postgres
---

# SQL query reviewer

Check each query against [the checklist](references/checklist.md) and report
findings with the file and line.
