// src/piiFields.js
// Defines which fields are sensitive PII and how they should be handled.
// Import this in your Mongoose models to keep field config in one place.

'use strict';

/**
 * PII field configuration.
 * Each entry defines how a sensitive field should be stored and displayed.
 *
 * @property {string}   maskType      - How to mask for display ('creditCard' | 'email' | 'phone' | 'name')
 * @property {boolean}  searchable    - Whether to create a blind index for exact-match search
 * @property {string}   [indexField]  - MongoDB field name for the blind index (if searchable: true)
 * @property {string}   description   - Human-readable description for documentation
 */
const PII_FIELDS = {
  creditCard: {
    maskType: 'creditCard',
    searchable: false,
    description: 'Credit/debit card number — last 4 digits kept for display',
  },
  email: {
    maskType: 'email',
    searchable: true,
    indexField: 'emailIndex',
    description: 'Email address — searchable via blind index',
  },
  phone: {
    maskType: 'phone',
    searchable: false,
    description: 'Phone number — last 4 digits kept for display',
  },
  fullName: {
    maskType: 'name',
    searchable: false,
    description: 'Full legal name',
  },
};

/**
 * Returns the list of field names that should be encrypted before DB storage
 */
function getEncryptedFieldNames() {
  return Object.keys(PII_FIELDS);
}

/**
 * Returns field names that have blind indexes for search
 */
function getSearchableFieldNames() {
  return Object.entries(PII_FIELDS)
    .filter(([, config]) => config.searchable)
    .map(([name]) => name);
}

module.exports = { PII_FIELDS, getEncryptedFieldNames, getSearchableFieldNames };