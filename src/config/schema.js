'use strict';

/**
 * Configuration schema for QCH Connect.
 *
 * Only variable NAMES and validation rules live here. No real values, resource
 * names, group names, or credentials belong in this file.
 *
 * PROVISIONAL: the production variable names below are placeholders chosen by
 * the scaffold so startup validation has something to check (PRD 18.5). They
 * must be reconciled with what QCH IT actually provisions and with the database
 * and Entra work being reviewed separately. Renaming them is a one-file change.
 *
 * Secrets (client secrets, connection strings) are intentionally NOT env
 * variables here. PRD 15.2 puts production secrets in Azure Key Vault, so only
 * non-secret locators are listed.
 */

// Environments the application recognizes. Anything else fails closed.
const ENVIRONMENTS = Object.freeze(['development', 'demo', 'test', 'production']);

// Marker used in .env.example for values that must come from QCH IT.
const PLACEHOLDER_MARKER = '<provided-by-qch-it>';

// Required only when APP_ENV=production. Values come from QCH IT.
const PRODUCTION_REQUIRED = Object.freeze([
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
  'KEY_VAULT_URI',
  'AZURE_SQL_SERVER',
  'AZURE_SQL_DATABASE',
  'GRAPH_SHARED_MAILBOX',
]);

const DEFAULT_PORT = 3000;

module.exports = Object.freeze({
  ENVIRONMENTS,
  PLACEHOLDER_MARKER,
  PRODUCTION_REQUIRED,
  DEFAULT_PORT,
});
