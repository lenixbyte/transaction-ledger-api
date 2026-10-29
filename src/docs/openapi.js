// OpenAPI 3 description served at /openapi.json and rendered by Swagger UI at /docs.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, example) => ({ 'application/json': { schema, ...(example && { example }) } });
const err = (description, code, message, details) => ({
  description,
  content: json(ref('Error'), { error: { code, message, ...(details && { details }) } }),
});

const E = {
  validation: err('Invalid input', 'VALIDATION_ERROR', 'Request validation failed',
    [{ field: 'reference_id', message: 'reference_id is required' }]),
  amount: err('Invalid amount', 'INVALID_AMOUNT', 'Invalid amount',
    [{ field: 'amount', message: 'amount must be greater than 0' }]),
  unauthorized: err('Missing, invalid or expired token', 'UNAUTHORIZED', 'Invalid or expired token. Log in again.'),
  insufficient: err('Not enough balance', 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit',
    { balance: 100, requested: 150 }),
};

const amountSchema = {
  type: 'number', minimum: 0.01, maximum: 1_000_000_000, multipleOf: 0.01, example: 100,
  description: 'Greater than 0, at most 2 decimal places',
};
const referenceSchema = {
  type: 'string', minLength: 1, maxLength: 100, example: 'dep-001',
  description: "Client-chosen idempotency key, unique per account. Must not start with 'transfer:'.",
};
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Transaction Ledger API',
    version: '1.0.0',
    description: [
      'Accounts, credit/debit transactions, balances, history and transfers.',
      '',
      '**How to try it:** call `POST /auth/signup` (or `/auth/login`), copy `access_token`, click **Authorize** and paste it.',
      'Every `/me` endpoint acts on the logged-in account, which is taken from the token, never from the URL.',
      '',
      'Amounts are JSON numbers in major units (e.g. rupees) with up to 2 decimals. All errors look like',
      '`{ "error": { "code", "message", "details?" } }`.',
    ].join('\n'),
  },
  tags: [
    { name: 'Auth', description: 'Create an account and log in' },
    { name: 'My account', description: 'Balance, transactions and history of the logged-in account' },
    { name: 'Transfers', description: 'Bonus: move money to another account atomically' },
    { name: 'Meta' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token from /auth/signup or /auth/login' } },
    schemas: {
      Error: {
        type: 'object', required: ['error'],
        properties: { error: { type: 'object', required: ['code', 'message'], properties: {
          code: { type: 'string', example: 'ACCOUNT_NOT_FOUND' },
          message: { type: 'string' },
          details: { description: 'Extra context: field errors, the existing record for duplicates, etc.' },
        } } },
      },
      Account: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Alice' },
          username: { type: 'string', example: 'alice' },
          balance: { type: 'number', example: 0 },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Token: {
        type: 'object',
        properties: {
          access_token: { type: 'string' },
          token_type: { type: 'string', enum: ['bearer'] },
          expires_at: { type: 'string', format: 'date-time' },
          account: ref('Account'),
        },
      },
      Balance: {
        type: 'object',
        properties: {
          account_id: { type: 'string', format: 'uuid' },
          balance: { type: 'number', example: 70 },
          as_of: { type: 'string', format: 'date-time' },
        },
      },
      Transaction: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_id: { type: 'string', format: 'uuid' },
          type: { type: 'string', enum: ['credit', 'debit'] },
          amount: { type: 'number', example: 30 },
          description: { type: 'string', nullable: true },
          reference_id: { type: 'string' },
          balance_after: { type: 'number', example: 70, description: 'Account balance right after this transaction' },
          transfer_id: { type: 'string', format: 'uuid', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      TransactionPage: {
        type: 'object',
        properties: {
          data: { type: 'array', items: ref('Transaction') },
          pagination: { type: 'object', properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total_records: { type: 'integer', example: 42 },
            total_pages: { type: 'integer', example: 3 },
          } },
        },
      },
      Transfer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          direction: { type: 'string', enum: ['sent', 'received'] },
          from_account_id: { type: 'string', format: 'uuid' },
          to_account_id: { type: 'string', format: 'uuid' },
          amount: { type: 'number', example: 30 },
          description: { type: 'string', nullable: true },
          reference_id: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          transaction: { ...ref('Transaction'), description: "The caller's own leg (debit if sent, credit if received)" },
        },
      },
    },
  },
  paths: {
    '/auth/signup': {
      post: {
        tags: ['Auth'], summary: 'Create an account (balance starts at 0) and log in',
        requestBody: { required: true, content: json({
          type: 'object', required: ['name', 'username', 'password'], additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, example: 'Alice' },
            username: { type: 'string', minLength: 3, maxLength: 50, pattern: '^[A-Za-z0-9_.-]+$', example: 'alice' },
            password: { type: 'string', minLength: 8, maxLength: 128, example: 'correct-horse' },
          },
        }) },
        responses: {
          201: { description: 'Account created; token returned', content: json(ref('Token')) },
          400: E.validation,
          409: err('Username already used', 'USERNAME_TAKEN', "Username 'alice' is already taken"),
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Log in and get a bearer token',
        requestBody: { required: true, content: json({
          type: 'object', required: ['username', 'password'],
          properties: { username: { type: 'string', example: 'alice' }, password: { type: 'string', example: 'correct-horse' } },
        }) },
        responses: {
          200: { description: 'Logged in', content: json(ref('Token')) },
          400: E.validation,
          401: err('Wrong username or password', 'INVALID_CREDENTIALS', 'Incorrect username or password'),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'], summary: 'Revoke the current token', security: [{ bearerAuth: [] }],
        responses: { 204: { description: 'Logged out' }, 401: E.unauthorized },
      },
    },
    '/me': {
      get: {
        tags: ['My account'], summary: 'My account', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'OK', content: json(ref('Account')) }, 401: E.unauthorized },
      },
    },
    '/me/balance': {
      get: {
        tags: ['My account'], summary: 'My current balance', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'OK', content: json(ref('Balance')) }, 401: E.unauthorized },
      },
    },
    '/me/transactions': {
      post: {
        tags: ['My account'], summary: 'Add a credit or debit (idempotent per reference_id)',
        description: 'Credit adds to the balance; debit subtracts and is rejected if the balance is too low. '
          + 'Re-sending a reference_id already used on this account creates nothing and returns 409 with the original.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: json({
          type: 'object', required: ['type', 'amount', 'reference_id'], additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['credit', 'debit'] },
            amount: amountSchema,
            description: { type: 'string', maxLength: 255, example: 'Salary' },
            reference_id: referenceSchema,
          },
        }) },
        responses: {
          201: { description: 'Created', content: json(ref('Transaction')) },
          400: { description: 'VALIDATION_ERROR, INVALID_AMOUNT, INVALID_TRANSACTION_TYPE or INVALID_REQUEST_BODY', content: json(ref('Error')) },
          401: E.unauthorized,
          409: err('reference_id already used on this account', 'DUPLICATE_TRANSACTION',
            "A transaction with reference_id 'dep-001' already exists for this account", { existing_transaction: {} }),
          422: E.insufficient,
        },
      },
      get: {
        tags: ['My account'], summary: 'My transaction history (latest first)', security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['credit', 'debit'] }, description: 'Omit for both' },
          ...pageParams,
        ],
        responses: {
          200: { description: 'OK', content: json(ref('TransactionPage')) },
          400: { description: 'INVALID_PAGINATION or INVALID_TRANSACTION_TYPE', content: json(ref('Error')) },
          401: E.unauthorized,
        },
      },
    },
    '/me/transactions/{id}': {
      get: {
        tags: ['My account'], summary: 'One of my transactions', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'OK', content: json(ref('Transaction')) },
          401: E.unauthorized,
          404: err('Not found (or not yours)', 'TRANSACTION_NOT_FOUND', "Transaction '…' does not exist"),
        },
      },
    },
    '/me/transfers': {
      post: {
        tags: ['Transfers'], summary: 'Send money to another account by its id (atomic)',
        description: 'Debits me and credits the recipient in one database transaction. If any step fails nothing changes.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: json({
          type: 'object', required: ['to_account_id', 'amount', 'reference_id'], additionalProperties: false,
          properties: {
            to_account_id: { type: 'string', format: 'uuid' },
            amount: amountSchema,
            description: { type: 'string', maxLength: 255, example: 'Rent share' },
            reference_id: { ...referenceSchema, example: 'rent-oct' },
          },
        }) },
        responses: {
          201: { description: 'Transfer done', content: json(ref('Transfer')) },
          400: E.validation,
          401: E.unauthorized,
          404: err('Recipient does not exist', 'ACCOUNT_NOT_FOUND', "Account '…' does not exist"),
          409: err('reference_id already used for one of my transfers', 'DUPLICATE_TRANSFER',
            "A transfer with reference_id 'rent-oct' already exists for this account", { existing_transfer: {} }),
          422: E.insufficient,
        },
      },
    },
    '/me/transfers/{id}': {
      get: {
        tags: ['Transfers'], summary: 'A transfer I sent or received', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'OK', content: json(ref('Transfer')) },
          401: E.unauthorized,
          404: err('Not found (or not mine)', 'TRANSFER_NOT_FOUND', "Transfer '…' does not exist"),
        },
      },
    },
    '/health': {
      get: { tags: ['Meta'], summary: 'Liveness + database check', responses: { 200: { description: 'OK' } } },
    },
  },
};
