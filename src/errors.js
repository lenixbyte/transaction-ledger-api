/** Every failure is returned as { error: { code, message, details? } } with a matching HTTP status. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  validation: (details, message = 'Request validation failed') => new ApiError(400, 'VALIDATION_ERROR', message, details),
  invalidBody: () => new ApiError(400, 'INVALID_REQUEST_BODY', 'Request body must be a valid JSON object'),
  invalidAmount: (details) => new ApiError(400, 'INVALID_AMOUNT', 'Invalid amount', details),
  invalidType: (value) => new ApiError(400, 'INVALID_TRANSACTION_TYPE', "'type' must be 'credit' or 'debit'", { field: 'type', value }),
  invalidPagination: (field, value, message) => new ApiError(400, 'INVALID_PAGINATION', message, { field, value }),
  unauthorized: (message = 'Invalid or expired token. Log in again.') => new ApiError(401, 'UNAUTHORIZED', message),
  invalidCredentials: () => new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password'),
  accountNotFound: (id) => new ApiError(404, 'ACCOUNT_NOT_FOUND', `Account '${id}' does not exist`),
  transactionNotFound: (id) => new ApiError(404, 'TRANSACTION_NOT_FOUND', `Transaction '${id}' does not exist`),
  transferNotFound: (id) => new ApiError(404, 'TRANSFER_NOT_FOUND', `Transfer '${id}' does not exist`),
  usernameTaken: (u) => new ApiError(409, 'USERNAME_TAKEN', `Username '${u}' is already taken`),
  duplicateTransaction: (existing) => new ApiError(409, 'DUPLICATE_TRANSACTION',
    `A transaction with reference_id '${existing.reference_id}' already exists for this account`,
    { existing_transaction: existing }),
  duplicateTransfer: (existing) => new ApiError(409, 'DUPLICATE_TRANSFER',
    `A transfer with reference_id '${existing.reference_id}' already exists for this account`,
    { existing_transfer: existing }),
  insufficientBalance: (details) => new ApiError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit', details),
};

export const PG_UNIQUE_VIOLATION = '23505';
