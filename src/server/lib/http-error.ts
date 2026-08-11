export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorStatus(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  return 500;
}
